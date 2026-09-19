# Windows 11 环境本地启动与测试指南

本文档介绍如何在 **Windows 11** 环境下编译并启动 `openwrt_status` 服务端，并使用随附的 `test_client.py` 客户端测试各项功能（包括**按需定时采样**与**远程命令执行及 5 秒防超时心跳机制**）。

---

## 准备工作

请确保您的 Windows 11 已安装以下基础环境：
- **Rust 工具链**：通过 `rustup` 安装（包含 `cargo`）
- **Python 3**：Python 3.8+（基于标准库编写，无需额外 `pip install`）
- **终端**：PowerShell 7 或系统内置 Windows PowerShell

---

## 第一步：编译与启动服务端

打开 PowerShell 终端，进入项目根目录：
```powershell
Set-Location c:\develop\openwrt_status
```

### 1. 编译项目
```powershell
# 语法与类型检查
cargo check

# 编译 Debug 版本 (开发调试推荐)
cargo build

# 或编译 Release 优化版本
cargo build --release
```

### 2. 启动服务端

#### 模式 A：默认公开访问（推荐首选）
```powershell
# 使用默认端口 9090
.\target\debug\openwrt_status.exe

# 或自定义端口（如 9091）
.\target\debug\openwrt_status.exe --port 9091
```

控制台看到如下输出即表示启动成功：
```text
INFO openwrt_status: Starting openwrt_status (Rust edition) v1.0.0...
INFO openwrt_status: Network sampler started with interval: 1.0s
INFO openwrt_status: API authentication disabled (Public access)
INFO openwrt_status: HTTP Server listening on http://0.0.0.0:9090
```

#### 模式 B：启用 Token 安全保护（可选）
```powershell
.\target\debug\openwrt_status.exe --port 9090 --token mysecrettoken
```

---

## 第二步：使用 Python 客户端测试按需采集

另开一个 **PowerShell** 窗口，进入项目根目录：

### 1. 健康检查与连通性测试
```powershell
python test_client.py -u http://127.0.0.1:9090 -e health
```

### 2. 获取全量状态（观察按需采样唤醒与休眠）
```powershell
python test_client.py -u http://127.0.0.1:9090
```
> 💡 **观察按需休眠与唤醒特性**：
> - 运行上述命令后，服务端控制台会立即打印：
>   `INFO openwrt_status::collector::network: Client connected! Network sampler awakened, resuming periodic sampling.`
> - 如果停止发起请求，静置 **10 秒** 后，服务端控制台会自动打印：
>   `INFO openwrt_status::collector::network: No client connected in 10s, network sampler entering idle sleep mode.`
>   采样器自动进入节能休眠，不再循环读取系统数据！

### 3. 动态实时监控仪表盘 (持续轮询)
```powershell
python test_client.py -u http://127.0.0.1:9090 --watch
```
每隔 2 秒自动刷新大屏，按 `Ctrl + C` 可随时退出监控。

---

## 第三步：测试远程命令执行 (`POST /api/v1/exec`)

`test_client.py` 内置了 `-c` / `--cmd` 参数，采用流式 SSE 协议实时接收服务端的**5 秒心跳保活**以及最终命令输出。

### 1. 快速命令测试
```powershell
python test_client.py -u http://127.0.0.1:9090 -c "echo Hello From OpenWrt Server"
```
**终端输出**：
```text
============================================================
  远程命令执行测试: echo Hello From OpenWrt Server
============================================================
目标服务: http://127.0.0.1:9090
设定超时: 120.0 秒
正在提交命令并等待执行流式输出 (期间每5秒服务端将发送一次心跳保活)...
------------------------------------------------------------
------------------------------------------------------------
✅ 执行成功! 退出码: 0, 服务端耗时: 0.01s (客户端总耗时: 0.18s)

[STDOUT 标准输出]:
Hello From OpenWrt Server
```

### 2. 长耗时命令测试 (验证每 5 秒心跳保活防超时)
在 Windows 下执行一个耗时 12 秒的命令：
```powershell
python test_client.py -u http://127.0.0.1:9090 -c "powershell -Command Start-Sleep -Seconds 12; Write-Output '12s Task Completed!'"
```
**终端输出**：
```text
============================================================
  远程命令执行测试: powershell -Command Start-Sleep -Seconds 12; Write-Output '12s Task Completed!'
============================================================
目标服务: http://127.0.0.1:9090
设定超时: 120.0 秒
正在提交命令并等待执行流式输出 (期间每5秒服务端将发送一次心跳保活)...
------------------------------------------------------------
⏱️ [服务端心跳保活 +5s] 命令正在服务器端执行中 (已执行 5 秒)...
⏱️ [服务端心跳保活 +10s] 命令正在服务器端执行中 (已执行 10 秒)...
------------------------------------------------------------
✅ 执行成功! 退出码: 0, 服务端耗时: 13.86s (客户端总耗时: 14.04s)

[STDOUT 标准输出]:
12s Task Completed!
```
> 💡 **防超时原理解析**：在命令执行的第 5 秒与第 10 秒，服务端主动向客户端发送了心跳状态事件，维系 TCP 连接活性，重置了代理与客户端的超时计时器。全部完成后一次性返回完整标准输出与退出码。

### 3. 超时安全保护测试
可通过 `--cmd-timeout` 指定超时上限（秒）。若超出时间，服务端将自动 kill 终止子进程并返回超时提示：
```powershell
python test_client.py -u http://127.0.0.1:9090 --cmd-timeout 3 -c "powershell -Command Start-Sleep -Seconds 8"
```
**终端输出**：
```text
❌ [服务端报错]: 命令执行超时 (超过 3 秒)
```

---

## 第四步：Token 认证安全测试（可选）

若服务端启动时携带了 `--token mysecret`：

1. **未携带 Token 或 Token 错误（被拦截）**：
   ```powershell
   python test_client.py -u http://127.0.0.1:9090 -c "echo hack"
   ```
   输出：`❌ [服务端报错]: HTTP 401: Unauthorized`

2. **携带正确 Token 执行**：
   ```powershell
   python test_client.py -u http://127.0.0.1:9090 -t mysecret -c "echo Authorized OK"
   ```
   输出：`✅ 执行成功! 退出码: 0`
