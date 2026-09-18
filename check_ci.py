import urllib.request
import json
import sys

headers = {"User-Agent": "openwrt-status-tool"}

def main():
    try:
        # 1. 获取最新的 workflow run
        runs_url = "https://api.github.com/repos/jefferymvp/openwrt_status/actions/runs?per_page=1"
        req = urllib.request.Request(runs_url, headers=headers)
        with urllib.request.urlopen(req) as resp:
            runs_data = json.loads(resp.read().decode("utf-8"))

        runs = runs_data.get("workflow_runs", [])
        if not runs:
            print("未找到任何 workflow runs。")
            return

        latest_run = runs[0]
        run_id = latest_run["id"]
        print(f"最新工作流: {latest_run['name']} (Run ID: {run_id})")
        print(f"触发事件: {latest_run.get('event')} | 状态: {latest_run.get('status')} | 结论: {latest_run.get('conclusion')}")
        print(f"工作流链接: {latest_run.get('html_url')}")
        print("=" * 60)

        # 2. 获取该 run 下的所有 jobs
        jobs_url = f"https://api.github.com/repos/jefferymvp/openwrt_status/actions/runs/{run_id}/jobs"
        req_jobs = urllib.request.Request(jobs_url, headers=headers)
        with urllib.request.urlopen(req_jobs) as resp:
            jobs_data = json.loads(resp.read().decode("utf-8"))

        jobs = jobs_data.get("jobs", [])
        for j in jobs:
            status_icon = "⏳" if j["status"] == "in_progress" else ("✅" if j["conclusion"] == "success" else "❌")
            print(f"{status_icon} {j['name']}: {j['status']} (结论: {j['conclusion']})")
            if "Android" in j["name"]:
                for s in j.get("steps", []):
                    s_icon = "⏳" if s["status"] == "in_progress" else ("✅" if s["conclusion"] == "success" else ("❌" if s["conclusion"] == "failure" else "⚪"))
                    print(f"    {s_icon} {s['name']}: {s['status']} ({s['conclusion']})")

    except Exception as e:
        print("查询发生错误:", e)

if __name__ == "__main__":
    main()
