# OpenWrt Status Backend Service

专为 OpenWrt 路由器打造的轻量级、高性能系统状态监控后端服务。使用 Go 语言编写，无需任何第三方外部依赖（纯静态编译），内存占用极低（< 10MB），并通过 GitHub Actions 自动交叉编译支持目前所有的主流软路由与硬路由平台架构。

---

## 特性亮点

- ⚡ **极致轻量**：基于 Go 标准库 `net/http` 打造，纯静态链接，适配 OpenWrt musl-libc 环境，二进制体积小巧，运行时占用内存小于 10MB。
- 🌡️ **全面指标采集**：
  - **CPU 频率**：支持多核动态频率读取 (`/sys/devices/system/cpu/cpufreq`) 与 `/proc/cpuinfo` 降级兜底。
  - **系统温度**：自动扫描并读取 `thermal_zone` 及 `hwmon` 传感器摄氏度（CPU / SoC / 外围传感器）。
  - **连接客户端**：解析 dnsmasq 租约 (`/tmp/dhcp.leases`) 与 ARP 邻居表 (`/proc/net/arp`)，统计在线客户端数量并输出 IP、MAC 及主机名列表。
  - **网络吞吐量与时间**：持续采集 `/proc/net/dev`，精确计算每个网络接口（WAN / LAN / WLAN）的毫秒时间戳与实时吞吐量（Bytes/s、KB/s、Mbps）。
  - **系统概览**：包含主机名、系统运行时间 (Uptime)、系统负载 (1/5/15) 及物理内存占用。
- 🌐 **开箱即用**：自带全量 CORS 跨域支持，支持与任意 Web 前端、Vue/React 单页应用或 Home Assistant 等无缝对接。
- 🔒 **可选安全认证**：支持设置 Token 鉴权（通过命令行参数 `-token` 或环境变量 `STATUS_TOKEN` 控制）。
- 🚀 **自动化流水线**：集成 GitHub Actions，覆盖 x86_64、x86_32、ARM64、ARMv7、ARMv5、MIPSLE (MT7621等)、MIPS 大端等多架构一键构建。

---

## API 接口文档

默认监听端口为 `:9090`，基础路径为 `/api/v1`。

### 1. 全量状态聚合接口
- **请求**: `GET /api/v1/status`
- **说明**: 一次性获取系统概览、CPU、温度、客户端及网卡吞吐量等全部数据。
- **响应示例**:
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "system": {
      "hostname": "OpenWrt",
      "current_time": "2026-09-18T17:20:00.123456789+08:00",
      "uptime_seconds": 128940,
      "uptime_format": "1天 11小时 49分 0秒",
      "load_avg_1": 0.12,
      "load_avg_5": 0.08,
      "load_avg_15": 0.05,
      "total_memory_kb": 1024256,
      "free_memory_kb": 614400,
      "avail_memory_kb": 789120,
      "memory_usage_percent": 22.9
    },
    "cpu": {
      "model_name": "MediaTek MT7621AT",
      "cores": 4,
      "avg_frequency_mhz": 880.0,
      "core_list": [
        { "core_id": 0, "frequency_mhz": 880.0 },
        { "core_id": 1, "frequency_mhz": 880.0 },
        { "core_id": 2, "frequency_mhz": 880.0 },
        { "core_id": 3, "frequency_mhz": 880.0 }
      ]
    },
    "thermal": {
      "sensors": [
        { "name": "cpu-thermal (thermal_zone0)", "temperature": 46.5, "type": "thermal_zone" }
      ]
    },
    "clients": {
      "total_clients": 2,
      "clients": [
        {
          "ip_address": "192.168.1.100",
          "mac_address": "aa:bb:cc:11:22:33",
          "hostname": "iPhone",
          "expires_at": "2026-09-18 23:59:59",
          "source": "dhcp"
        },
        {
          "ip_address": "192.168.1.105",
          "mac_address": "dd:ee:ff:44:55:66",
          "hostname": "",
          "expires_at": "Never",
          "source": "arp"
        }
      ]
    },
    "network": {
      "timestamp": "2026-09-18T17:20:00.123456789+08:00",
      "interfaces": [
        {
          "interface": "eth0",
          "rx_bytes_per_sec": 154200.0,
          "tx_bytes_per_sec": 32800.0,
          "rx_kbps": 1233.6,
          "tx_kbps": 262.4,
          "rx_mbps": 1.23,
          "tx_mbps": 0.26,
          "rx_total_bytes": 104857600,
          "tx_total_bytes": 52428800,
          "rx_total_packets": 82000,
          "tx_total_packets": 41000,
          "rx_errors": 0,
          "tx_errors": 0,
          "timestamp": "2026-09-18T17:20:00.123456789+08:00"
        }
      ]
    }
  }
}
```

### 2. 独立功能接口
| 接口 | 方法 | 说明 |
| :--- | :--- | :--- |
| `/api/v1/cpu` | GET | 单独获取 CPU 型号、核心数、各核频率及平均频率 |
| `/api/v1/thermal` | GET | 单独获取系统温度传感器摄氏度列表 |
| `/api/v1/clients` | GET | 单独获取当前连接设备总数与客户端列表（IP、MAC、主机名等） |
| `/api/v1/network` | GET | 单独获取各网卡最新时间戳与实时吞吐速率（Bytes/s、kbps、mbps） |
| `/api/v1/health` | GET | 服务健康检查接口 |

---

## Python 测试客户端使用说明

仓库根目录下提供了零依赖的 Python 测试脚本 [test_client.py](test_client.py)，基于标准库开发，无需安装任何第三方库即可在电脑端测试与监控路由器：

### 1. 单次快速测试全量接口
```sh
python test_client.py -u http://192.168.1.1:9090
```

### 2. 实时动态仪表盘模式 (每 2 秒自动刷新)
```sh
python test_client.py -u http://192.168.1.1:9090 --watch
```

### 3. 带 Token 鉴权或测试单个接口
```sh
# 测试特定接口 (如 network)
python test_client.py -u http://192.168.1.1:9090 -e network

# 携带安全 Token
python test_client.py -u http://192.168.1.1:9090 -t your_secret_token
```

---

## 快速安装与部署 (OpenWrt)

### 1. 下载对应架构二进制
在 GitHub 仓库的 **Releases** 页面下载对应路由器架构的压缩包：

- **x86 软路由 (64位)**: `openwrt-status-linux-amd64.tar.gz`
- **ARM64 (如 NanoPi R2S/R4S/R5S/R6S、树莓派4/5、RK3568)**: `openwrt-status-linux-arm64.tar.gz`
- **ARMv7 (如 斐讯K3、华硕、BCM 等)**: `openwrt-status-linux-armv7.tar.gz`
- **MIPSLE 软浮点 (常见 MT7621、MT7620、新路由3、K2P 等)**: `openwrt-status-linux-mipsle-softfloat.tar.gz`
- **MIPS 软浮点 (Atheros AR71xx、AR93xx 等大端平台)**: `openwrt-status-linux-mips-softfloat.tar.gz`

### 2. 上传并安装到 OpenWrt
通过 SSH 或 SCP 将压缩包上传至路由器 `/tmp` 目录并解压：

```sh
cd /tmp
tar -zxvf openwrt-status-linux-*.tar.gz

# 移动二进制文件并赋予执行权限
mv openwrt-status /usr/bin/
chmod +x /usr/bin/openwrt-status

# 安装 procd 服务脚本
mv openwrt-status /etc/init.d/openwrt-status
chmod +x /etc/init.d/openwrt-status

# 启用开机自启并启动服务
/etc/init.d/openwrt-status enable
/etc/init.d/openwrt-status start
```

### 3. 验证运行状态
使用 `curl` 即可直接测试接口：
```sh
curl http://127.0.0.1:9090/api/v1/status
```

---

## 配置参数与自定义选项

服务支持通过命令行参数或环境变量进行配置：

| 命令行参数 | 环境变量 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `-port` | `STATUS_PORT` | `9090` | HTTP 服务监听端口 |
| `-host` | `STATUS_HOST` | `0.0.0.0` | HTTP 服务监听地址 |
| `-interval`| `STATUS_INTERVAL` | `1s` | 网卡吞吐量采样间隔 |
| `-token` | `STATUS_TOKEN` | `""` | 访问 API 所需鉴权 Token（留空则不开启鉴权） |
| `-version` | - | - | 查看程序版本与 Commit 信息 |

> **提示**：若启用了 Token 鉴权，请求时可在 Header 中携带 `Authorization: Bearer <your-token>`，或者在 URL 查询参数中添加 `?token=<your-token>`。

---

## GitHub Actions 自动编译发布

本项目已经配置了完整的 GitHub Actions 工作流：
1. **持续编译**：代码合并或推送到 `main` 分支时，会自动触发各架构编译并保存构建产物 Artifacts（保留 7 天）。
2. **自动发布 Release**：只要打上版本 Tag 并推送至 GitHub（例如 `git tag v1.0.0 && git push origin v1.0.0`），GitHub Actions 会自动编译 7 大主流芯片架构的发布包，生成 SHA256 校验清单，并自动创建 GitHub Release！
