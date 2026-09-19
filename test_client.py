#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OpenWrt Status API 测试客户端 (Python 3)
基于标准库 urllib 实现，无需安装第三方依赖即可直接运行。

使用示例:
  1. 单次快速测试全量接口:
     python test_client.py -u http://192.168.1.1:9090

  2. 启用实时动态监控 (类似仪表盘，每 2 秒刷新一次):
     python test_client.py -u http://192.168.1.1:9090 --watch

  3. 携带 Token 鉴权:
     python test_client.py -u http://192.168.1.1:9090 -t mysecrettoken

  4. 仅测试特定接口:
     python test_client.py -u http://192.168.1.1:9090 -e network
"""

import argparse
import json
import os
import sys
import time
import urllib.request

# 解决 Windows 控制台默认 GBK 导致 emoji 报错的问题
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


class OpenWrtClient:
    def __init__(self, base_url: str, token: str = "", timeout: float = 5.0):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    def request(self, path: str) -> dict:
        """发起 HTTP GET 请求并解析 JSON 响应"""
        url = f"{self.base_url}{path}"
        headers = {
            "User-Agent": "OpenWrt-Status-PythonClient/1.0",
            "Accept": "application/json",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        req = urllib.request.Request(url, headers=headers, method="GET")
        start = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                elapsed_ms = (time.perf_counter() - start) * 1000
                data = json.loads(resp.read().decode("utf-8"))
                return {
                    "success": True,
                    "status_code": resp.status,
                    "elapsed_ms": elapsed_ms,
                    "data": data,
                }
        except urllib.error.HTTPError as e:
            elapsed_ms = (time.perf_counter() - start) * 1000
            err_body = e.read().decode("utf-8", errors="ignore")
            return {
                "success": False,
                "status_code": e.code,
                "elapsed_ms": elapsed_ms,
                "error": f"HTTP {e.code}: {e.reason}",
                "body": err_body,
            }
        except urllib.error.URLError as e:
            return {
                "success": False,
                "status_code": 0,
                "elapsed_ms": 0,
                "error": f"网络连接失败: {e.reason}",
            }
        except Exception as e:
            return {
                "success": False,
                "status_code": 0,
                "elapsed_ms": 0,
                "error": f"请求异常: {str(e)}",
            }

    def exec_stream(self, command: str, timeout: float = 120.0):
        """调用 POST /api/v1/exec 接口，流式接收执行状态心跳与最终执行结果"""
        url = f"{self.base_url}/api/v1/exec"
        headers = {
            "User-Agent": "OpenWrt-Status-PythonClient/1.0",
            "Content-Type": "application/json",
            "Accept": "text/event-stream, application/json",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        payload = json.dumps({"command": command, "timeout": int(timeout)}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(req, timeout=timeout + 15) as resp:
                for line in resp:
                    line_str = line.decode("utf-8", errors="replace").strip()
                    if not line_str or line_str.startswith(":"):
                        continue
                    if line_str.startswith("data:"):
                        raw_json = line_str[5:].strip()
                        try:
                            item = json.loads(raw_json)
                            yield item
                        except Exception:
                            yield {"type": "raw", "data": raw_json}
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            yield {"type": "error", "error": f"HTTP {e.code}: {e.reason}", "body": err_body}
        except Exception as e:
            yield {"type": "error", "error": f"请求异常: {str(e)}"}


def print_banner(title: str):
    print("\n" + "=" * 60)
    print(f"  {title}")
    print("=" * 60)


def print_all_status(data: dict):
    """格式化打印全量状态"""
    sys_info = data.get("system", {})
    cpu = data.get("cpu", {})
    thermal = data.get("thermal", {})
    clients = data.get("clients", {})
    network = data.get("network", {})

    print_banner("1. 系统概览 (System Overview)")
    print(f"  主机名       : {sys_info.get('hostname', 'N/A')}")
    print(f"  系统运行时间 : {sys_info.get('uptime_format', 'N/A')}")
    print(f"  当前系统时间 : {sys_info.get('current_time', 'N/A')}")
    print(
        f"  平均负载     : 1min: {sys_info.get('load_avg_1')} | 5min: {sys_info.get('load_avg_5')} | 15min: {sys_info.get('load_avg_15')}"
    )
    total_mem = sys_info.get("total_memory_kb", 0) / 1024
    free_mem = sys_info.get("free_memory_kb", 0) / 1024
    avail_mem = sys_info.get("avail_memory_kb", 0) / 1024
    print(
        f"  内存占用     : {sys_info.get('memory_usage_percent')}% (总计: {total_mem:.1f} MB, 可用: {avail_mem:.1f} MB, 空闲: {free_mem:.1f} MB)"
    )

    print_banner("2. CPU 状态 (CPU Frequency & Cores)")
    print(f"  CPU 型号     : {cpu.get('model_name', 'N/A')}")
    print(f"  核心总数     : {cpu.get('cores', 0)}")
    print(f"  平均频率     : {cpu.get('avg_frequency_mhz', 0)} MHz")
    core_list = cpu.get("core_list", [])
    if core_list:
        core_str = ", ".join(
            [f"Core#{c.get('core_id')}: {c.get('frequency_mhz')} MHz" for c in core_list]
        )
        print(f"  核心明细     : {core_str}")

    print_banner("3. 系统温度 (Thermal Sensors)")
    sensors = thermal.get("sensors", [])
    if sensors:
        for s in sensors:
            print(f"  - {s.get('name')}: {s.get('temperature')} °C")
    else:
        print("  未检测到可用温度传感器或未启用驱动")

    print_banner("4. 在线客户端 (Connected Clients)")
    print(f"  客户端总数   : {clients.get('total_clients', 0)}")
    client_list = clients.get("clients", [])
    if client_list:
        print(f"  {'IP 地址':<16} {'MAC 地址':<18} {'主机名':<20} {'来源':<6} {'租约到期'}")
        print("  " + "-" * 75)
        for c in client_list:
            hostname = c.get("hostname") or "(未知)"
            print(
                f"  {c.get('ip_address', ''):<16} {c.get('mac_address', ''):<18} {hostname:<20} {c.get('source', ''):<6} {c.get('expires_at', '')}"
            )
    else:
        print("  当前暂无连接客户端记录")

    print_banner("5. 网络接口与实时吞吐量 (Network Throughput)")
    ts = network.get("timestamp", "N/A")
    print(f"  采样时间戳   : {ts}")
    ifaces = network.get("interfaces", [])
    if ifaces:
        print(
            f"  {'接口':<10} {'下载/接收 (RX)':<20} {'上传/发送 (TX)':<20} {'累计 RX':<14} {'累计 TX'}"
        )
        print("  " + "-" * 80)
        for iface in ifaces:
            rx_rate = f"{iface.get('rx_kbps', 0):.1f} kbps ({iface.get('rx_mbps', 0):.2f} MB/s)"
            tx_rate = f"{iface.get('tx_kbps', 0):.1f} kbps ({iface.get('tx_mbps', 0):.2f} MB/s)"
            rx_total = format_bytes(iface.get("rx_total_bytes", 0))
            tx_total = format_bytes(iface.get("tx_total_bytes", 0))
            print(
                f"  {iface.get('interface', ''):<10} {rx_rate:<20} {tx_rate:<20} {rx_total:<14} {tx_total}"
            )
    else:
        print("  未检测到可用网络接口")


def format_bytes(size: int) -> str:
    """格式化字节大小为人类可读格式"""
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if size < 1024.0:
            return f"{size:.1f} {unit}"
        size /= 1024.0
    return f"{size:.1f} PB"


def run_single_test(client: OpenWrtClient, endpoint: str):
    """单次运行指定或全量接口测试"""
    endpoints = {
        "health": "/api/v1/health",
        "status": "/api/v1/status",
        "cpu": "/api/v1/cpu",
        "thermal": "/api/v1/thermal",
        "clients": "/api/v1/clients",
        "network": "/api/v1/network",
    }

    if endpoint != "all":
        path = endpoints.get(endpoint, f"/api/v1/{endpoint}")
        print(f"\n[测试请求] GET {client.base_url}{path} ...")
        res = client.request(path)
        if res["success"]:
            print(f"[成功] HTTP {res['status_code']} (耗时 {res['elapsed_ms']:.1f} ms)")
            print(json.dumps(res["data"], indent=2, ensure_ascii=False))
        else:
            print(f"[失败] {res.get('error')}")
            if "body" in res:
                print(f"响应内容: {res['body']}")
        return

    # 全量接口依次测试
    print(f"正在对目标服务 {client.base_url} 进行全量连通性测试...\n")

    # 1. 探测健康检查
    health_res = client.request("/api/v1/health")
    if not health_res["success"]:
        print(f"[错误] 无法连接到服务: {health_res.get('error')}")
        print("请检查路由器 IP、端口 (默认 9090) 是否正确，或服务是否已启动。")
        sys.exit(1)
    print(f"✅ 服务健康检查正常 (耗时 {health_res['elapsed_ms']:.1f} ms)")

    # 2. 获取全量状态数据
    status_res = client.request("/api/v1/status")
    if not status_res["success"]:
        print(f"❌ 获取全量状态失败: {status_res.get('error')}")
        sys.exit(1)

    payload = status_res["data"].get("data", {})
    print_all_status(payload)
    print("\n✅ 全量状态获取并解析成功！")


def run_watch_mode(client: OpenWrtClient, interval: float = 2.0):
    """动态监控模式 (持续轮询刷新)"""
    print(f"已进入动态监控模式，目标: {client.base_url}，每 {interval} 秒刷新一次。按 Ctrl+C 退出。")
    time.sleep(1)

    while True:
        try:
            res = client.request("/api/v1/status")
            if os.name == "nt":
                os.system("cls")
            else:
                os.system("clear")

            print(f"=== OpenWrt 实时监控面板 ({time.strftime('%Y-%m-%d %H:%M:%S')}) ===")
            if res["success"]:
                payload = res["data"].get("data", {})
                print_all_status(payload)
            else:
                print(f"\n[请求失败]: {res.get('error')}")

            time.sleep(interval)
        except KeyboardInterrupt:
            print("\n已退出动态监控。")
            break


def run_exec_test(client: OpenWrtClient, command: str, timeout: float = 120.0):
    """测试命令执行接口并实时打印每5秒的心跳与最终结果"""
    print_banner(f"远程命令执行测试: {command}")
    print(f"目标服务: {client.base_url}")
    print(f"设定超时: {timeout} 秒")
    print("正在提交命令并等待执行流式输出 (期间每5秒服务端将发送一次心跳保活)...")
    print("-" * 60)

    start_time = time.perf_counter()
    for event in client.exec_stream(command=command, timeout=timeout):
        event_type = event.get("type")
        if event_type == "status":
            elapsed = event.get("elapsed_seconds", 0)
            msg = event.get("message", "")
            print(f"⏱️ [服务端心跳保活 +{elapsed}s] {msg}")
        elif event_type == "result":
            exit_code = event.get("exit_code")
            success = event.get("success")
            stdout = event.get("stdout", "")
            stderr = event.get("stderr", "")
            elapsed = event.get("elapsed_seconds", 0.0)
            total_real = time.perf_counter() - start_time
            print("-" * 60)
            if success:
                print(f"✅ 执行成功! 退出码: {exit_code}, 服务端耗时: {elapsed:.2f}s (客户端总耗时: {total_real:.2f}s)")
            else:
                print(f"❌ 执行失败! 退出码: {exit_code}, 服务端耗时: {elapsed:.2f}s")

            if stdout:
                print("\n[STDOUT 标准输出]:")
                print(stdout.rstrip())
            if stderr:
                print("\n[STDERR 错误输出]:")
                print(stderr.rstrip())
            return
        elif event_type == "error":
            print(f"\n❌ [服务端报错]: {event.get('error') or event.get('message')}")
            if "body" in event:
                print(f"详情: {event['body']}")
            return
        else:
            print(f"ℹ️ [原始消息]: {event}")


def main():
    parser = argparse.ArgumentParser(description="OpenWrt 状态监控后端 Python 测试客户端")
    parser.add_argument(
        "-u",
        "--url",
        default="http://127.0.0.1:9090",
        help="目标服务地址 (默认: http://127.0.0.1:9090)",
    )
    parser.add_argument(
        "-t",
        "--token",
        default="",
        help="API 认证 Token (若服务端开启了鉴权保护)",
    )
    parser.add_argument(
        "-e",
        "--endpoint",
        choices=["all", "status", "cpu", "thermal", "clients", "network", "health"],
        default="all",
        help="指定测试的接口 (默认: all 测试全部)",
    )
    parser.add_argument(
        "-w",
        "--watch",
        action="store_true",
        help="开启持续动态监控模式 (每 2 秒刷新一次)",
    )
    parser.add_argument(
        "-i",
        "--interval",
        type=float,
        default=2.0,
        help="动态监控刷新时间间隔 (秒，默认: 2.0)",
    )
    parser.add_argument(
        "-c",
        "--cmd",
        "--exec",
        dest="command",
        default=None,
        help="在服务端执行指定命令并实时接收状态心跳与执行结果",
    )
    parser.add_argument(
        "--cmd-timeout",
        type=float,
        default=120.0,
        help="命令执行超时时间 (秒，默认: 120.0)",
    )

    args = parser.parse_args()
    client = OpenWrtClient(base_url=args.url, token=args.token)

    if args.command:
        run_exec_test(client, command=args.command, timeout=args.cmd_timeout)
    elif args.watch:
        run_watch_mode(client, interval=args.interval)
    else:
        run_single_test(client, endpoint=args.endpoint)


if __name__ == "__main__":
    main()
