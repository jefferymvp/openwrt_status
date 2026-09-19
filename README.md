# OpenWrt Status Backend Service & Mobile App (Rust Edition)

专为 OpenWrt 路由器打造的极致轻量、高性能系统状态监控与远程命令执行服务。使用 **Rust** 语言编写，具备**零运行时开销（无 GC）**、**超低内存占用（仅 1~3MB）** 与**极小二进制体积**等特点，针对主流 **x86 与 ARM** 平台提供纯静态 musl 预编译包，并配备现代 Argon 玻璃拟物风格的移动端 Web / Android App。

---

## 特性亮点

### 1. 服务端核心特性 (Rust Backend)
- ⚡ **极致轻量**：基于 Rust 2021 + Tokio + Axum，常驻内存仅需 **1MB ~ 3MB**，CPU 开销微乎其微。
- 💤 **智能按需采样与节能休眠 (Smart Standby)**：
  - 内置客户端连接感知机制。当超过 10 秒无任何客户端请求时，后台数据采样协程自动休眠挂起，停止系统 IO 与 CPU 占用；
  - 任意客户端发起请求时，毫秒级无感自动唤醒并恢复定时采样。
- 💻 **远程命令执行引擎 (`POST /api/v1/exec`)**：
  - 支持远程在路由器服务端执行 Shell 命令；
  - 采用 **SSE (Server-Sent Events)** 流式机制，在命令长时间执行期间，**每 5 秒自动向客户端发送心跳保活注释帧**，彻底避免网关代理超时中断；
  - 执行结束后即时返回退出状态码 (`exit_code`)、标准输出、错误输出与耗时，支持超时保护与 Token 鉴权。
- 🌡️ **全面指标采集**：
  - **CPU 频率与架构**：动态读取 `/sys/devices/system/cpu/cpufreq` 与 `/proc/cpuinfo`。
  - **系统温度**：自动扫描 `thermal_zone` 及 `hwmon` 传感器摄氏度（CPU / SoC / 外围传感器）。
  - **客户端资产**：解析 dnsmasq 租约 (`/tmp/dhcp.leases`) 与 ARP 邻居表 (`/proc/net/arp`)。
  - **网络吞吐量**：精确计算各网卡（WAN / LAN / WLAN）毫秒时间戳与实时吞吐量（Bytes/s、KB/s、Mbps）。
  - **系统运行状态**：主机名、系统运行时间 (Uptime)、系统负载 (1/5/15) 及物理内存。
- 🔒 **安全认证与跨域**：支持 Token 鉴权（命令行 `-t / --token` 或环境变量 `STATUS_TOKEN`），自带全量 CORS 跨域支持。
- 🚀 **自动化 CI/CD**：GitHub Actions 全自动交叉编译 `x86_64`、`i686`、`aarch64`、`armv7` 4 大架构 musl 二进制与 Android APK。

### 2. 客户端 App 特性 (Argon Mobile App)
- 🗂️ **多服务器配置方案 (Multi-Schema)**：
  - 支持保存多个路由器的连接方案（名称、IP、端口、Token、刷新间隔等）；
  - 支持快速新建、编辑、删除方案，并在弹窗中通过可视化方案胶囊卡片或下拉菜单一键秒切；
  - **切换方案时自动清空旧主机数据**，重连新服务器后展示新数据，互不干扰。
- ⌨️ **远程命令控制台 (Command Console)**：
  - 导航栏独立页面，内置连通性测试、磁盘挂载、内存、运行时间等多条常用预设命令；
  - 支持命令自定义增删改与自由输入；
  - 配备专业控制台终端输出区、毫秒级执行秒表、退出状态码指示灯与心跳保活次数统计。
- 🏷️ **设备资产自定义命名与备注 (Device Aliases)**：
  - 针对“未知设备”支持用户自定义命名（如“客厅电视”、“我的iPhone”、“群晖NAS”）；
  - 以物理 MAC 地址唯一绑定并持久化保存，IP 变动不丢失；
  - 已命名设备高亮显示并带金色 `[已备注]` 徽标，同时保留系统原始名称便于追溯；
  - 全局设备搜索框全面联动别名即时过滤；支持一键复制设备 IP。
- 🔄 **双页面丝滑下拉刷新 (Pull to Refresh)**：
  - 在“监控”与“设备”页面支持手势下拉刷新，配备弹性阻尼动画与状态指示器；
  - 全面兼顾移动端触控手势与桌面端鼠标拖拽模拟。
- 🎨 **Argon 深度暗黑视觉调优**：
  - 声明原生 `color-scheme: dark`，彻底解决各平台下拉菜单白底刺眼与文字溢出问题；
  - 全面配备防浏览器 304 缓存机制。

---

## 📱 界面预览 (Argon 风格客户端)

| 仪表盘监控页 (`main.jpg`) | 在线设备管理页 (`device.jpg`) |
| :-----------------------: | :--------------------------: |
| <img src="snapshot/main.jpg" width="360" alt="监控仪表盘"/> | <img src="snapshot/device.jpg" width="360" alt="设备列表与筛选"/> |

---

## 本地开发与测试 (Windows / Linux / macOS)

### 1. 语法检查与编译
```bash
cargo check
cargo build
```

### 2. 本地启动服务
```bash
# 默认端口 9090，可指定端口或鉴权 Token
cargo run -- --port 9090
```

### 3. 使用随附 Python 客户端测试
```bash
# 单次快速全量状态测试
python test_client.py -u http://127.0.0.1:9090

# 开启实时动态监控仪表盘 (每 2 秒刷新)
python test_client.py -u http://127.0.0.1:9090 --watch

# 远程执行命令测试 (流式接收输出与心跳保活)
python test_client.py -u http://127.0.0.1:9090 -c "uptime"
```

### 4. 启动客户端 Web App 调试
```bash
# 进入前端目录或直接通过 Python 启动静态文件服务器
python -m http.server 5173 --directory openwrt_status_app
# 浏览器访问 http://localhost:5173
```

---

## API 接口文档

默认监听端口为 `:9090`，基础路径为 `/api/v1`。

### 1. 全量状态聚合接口
- **请求**: `GET /api/v1/status`
- **说明**: 一次性获取系统概览、CPU、温度、客户端及网卡吞吐量等全部数据。

### 2. 独立功能接口列表
| 接口 | 方法 | 说明 |
| :--- | :--- | :--- |
| `/api/v1/cpu` | GET | 单独获取 CPU 型号、核心数、各核频率及平均频率 |
| `/api/v1/thermal` | GET | 单独获取系统温度传感器摄氏度列表 |
| `/api/v1/clients` | GET | 单独获取当前连接设备总数与客户端列表（IP、MAC、主机名等） |
| `/api/v1/network` | GET | 单独获取各网卡最新时间戳与实时吞吐速率（Bytes/s、kbps、mbps） |
| `/api/v1/exec` | POST | 远程命令执行流式接口（SSE 保活心跳 + 退出码输出） |
| `/api/v1/health` | GET | 服务健康检查接口 |

### 3. 远程命令执行接口说明 (`POST /api/v1/exec`)
- **请求体 (JSON)**：
```json
{
  "command": "ping -c 4 223.5.5.5",
  "timeout": 60
}
```
- **返回响应类型**：`text/event-stream`
- **流式格式**：
  - **保活心跳（每 5 秒自动下发）**：`:heartbeat\n\n`
  - **最终结果帧**：
```json
data: {"code":200,"data":{"command":"ping -c 4 223.5.5.5","elapsed_seconds":3.02,"exit_code":0,"stderr":"","stdout":"..."},"message":"success"}
```

---

## 快速安装与部署 (OpenWrt)

### 1. 下载对应架构二进制
在 GitHub 仓库的 **Releases** 页面下载对应路由器架构的压缩包：

- **x86 软路由 (64位)**: `openwrt-status-x86_64-musl.tar.gz`
- **x86 软路由 (32位)**: `openwrt-status-i686-musl.tar.gz`
- **ARM64 (如 NanoPi R2S/R4S/R5S/R6S、树莓派4/5、RK3568)**: `openwrt-status-aarch64-musl.tar.gz`
- **ARMv7 (如 斐讯K3、华硕、BCM 等)**: `openwrt-status-armv7-musleabihf.tar.gz`
- **安卓客户端 (Android App)**: `openwrt-status-app.apk`

### 2. 上传并安装到 OpenWrt
通过 SSH 或 SCP 将压缩包上传至路由器 `/tmp` 目录并解压：

```sh
cd /tmp
tar -zxvf openwrt-status-*.tar.gz

# 移动二进制文件并赋予执行权限
mv openwrt-status /usr/bin/
chmod +x /usr/bin/openwrt-status

# 安装 procd 服务脚本并赋予执行权限
mv openwrt-status.init /etc/init.d/openwrt-status
chmod +x /etc/init.d/openwrt-status

# 启用开机自启并启动服务
/etc/init.d/openwrt-status enable
/etc/init.d/openwrt-status start
```

---

## 配置参数与自定义选项

服务支持通过命令行参数或环境变量进行配置：

| 命令行参数 | 环境变量 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `-p`, `--port` | `STATUS_PORT` | `9090` | HTTP 服务监听端口 |
| `--host` | `STATUS_HOST` | `0.0.0.0` | HTTP 服务监听地址 |
| `-i`, `--interval`| `STATUS_INTERVAL`| `1.0` | 网卡吞吐量采样间隔 (秒) |
| `-t`, `--token` | `STATUS_TOKEN` | `""` | 访问 API 所需鉴权 Token（留空则不开启鉴权） |
| `-V`, `--version` | - | - | 查看程序版本 |
