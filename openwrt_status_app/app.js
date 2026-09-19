/**
 * OpenWrt Status - Argon Edition Mobile Controller
 * Multi-schema Profiles, Real-time Visualizer, Terminal Command Execution & Polling Manager
 */

const STORAGE_SCHEMAS_KEY = 'openwrt_status_schemas';
const STORAGE_ACTIVE_SCHEMA_KEY = 'openwrt_status_active_schema_id';
const STORAGE_COMMANDS_KEY = 'openwrt_status_saved_commands';
const STORAGE_DEVICE_ALIASES_KEY = 'openwrt_status_device_aliases';

// 默认服务器方案预设
const DEFAULT_SCHEMAS = [
  {
    id: 'schema_default',
    name: '默认路由器 (ZXHNF7015)',
    host: '192.168.6.88',
    port: 9090,
    token: '',
    interval: 1.5,
    selectedInterface: 'auto',
  },
];

// 默认命令预设
const DEFAULT_COMMANDS = [
  { id: 'cmd_1', name: '连通性测试 (Ping 阿里云 DNS)', command: 'ping -c 4 223.5.5.5' },
  { id: 'cmd_2', name: '查看磁盘与挂载空间 (df -h)', command: 'df -h' },
  { id: 'cmd_3', name: '查看物理内存使用 (free -m)', command: 'free -m' },
  { id: 'cmd_4', name: '系统运行时间与平均负载 (uptime)', command: 'uptime' },
  { id: 'cmd_5', name: '查看 CPU 详细架构与型号', command: 'cat /proc/cpuinfo | grep -E "model name|Processor|BogoMIPS" | head -n 8' },
  { id: 'cmd_6', name: '查看当前路由表 (ip route)', command: 'ip route show' },
  { id: 'cmd_7', name: '测试长耗时与5秒心跳保活 (Sleep 12s)', command: 'powershell -Command Start-Sleep -Seconds 12; Write-Output "12s Finished!"' },
];

class OpenWrtApp {
  constructor() {
    // 1. 初始化 Schemas 与活动配置
    this.schemas = this.loadSchemas();
    this.activeSchemaId = this.loadActiveSchemaId();
    this.config = this.getActiveSchema();

    // 2. 初始化预设命令与设备自定义命名
    this.savedCommands = this.loadSavedCommands();
    this.deviceAliases = this.loadDeviceAliases();
    this.currentCmdAbortController = null;
    this.cmdTimer = null;
    this.cmdStartTime = 0;
    this.cmdHeartbeatCount = 0;

    // 3. 运行状态与图表
    this.timer = null;
    this.isPolling = false;
    this.lastLatency = 0;
    this.networkHistory = {
      rx: new Array(30).fill(0),
      tx: new Array(30).fill(0),
    };

    this.initElements();
    this.bindEvents();
    this.renderSchemaSelect();
    this.renderCommandSelect();
    this.applyConfigToUI();
    this.initCanvas();
    this.startPolling();
  }

  /* ================= 0. 设备自定义命名与备注管理 ================= */

  loadDeviceAliases() {
    try {
      const saved = localStorage.getItem(STORAGE_DEVICE_ALIASES_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.error('Failed to load device aliases', e);
    }
    return {};
  }

  saveDeviceAliases() {
    try {
      localStorage.setItem(STORAGE_DEVICE_ALIASES_KEY, JSON.stringify(this.deviceAliases));
    } catch (e) {
      console.error('Failed to save device aliases', e);
    }
  }

  getDeviceAlias(mac) {
    if (!mac) return '';
    const key = mac.toLowerCase().trim();
    return this.deviceAliases[key] || '';
  }

  setDeviceAlias(mac, alias) {
    if (!mac) return;
    const key = mac.toLowerCase().trim();
    const clean = (alias || '').trim();
    if (clean) {
      this.deviceAliases[key] = clean;
    } else {
      delete this.deviceAliases[key];
    }
    this.saveDeviceAliases();
    this.renderFilteredClients();
  }

  /* ================= 1. Schemas 配置方案管理 ================= */

  loadSchemas() {
    try {
      const saved = localStorage.getItem(STORAGE_SCHEMAS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.error('Failed to load schemas from localStorage', e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_SCHEMAS));
  }

  loadActiveSchemaId() {
    const saved = localStorage.getItem(STORAGE_ACTIVE_SCHEMA_KEY);
    if (saved && this.schemas.some((s) => s.id === saved)) {
      return saved;
    }
    return this.schemas[0] ? this.schemas[0].id : 'schema_default';
  }

  saveSchemas() {
    try {
      localStorage.setItem(STORAGE_SCHEMAS_KEY, JSON.stringify(this.schemas));
      localStorage.setItem(STORAGE_ACTIVE_SCHEMA_KEY, this.activeSchemaId);
    } catch (e) {
      console.error('Failed to save schemas to localStorage', e);
    }
  }

  getActiveSchema() {
    let schema = this.schemas.find((s) => s.id === this.activeSchemaId);
    if (!schema) {
      schema = this.schemas[0] || DEFAULT_SCHEMAS[0];
      this.activeSchemaId = schema.id;
    }
    return { ...schema };
  }

  renderSchemaSelect() {
    if (!this.schemaSelect) return;
    this.schemaSelect.innerHTML = '';
    this.schemas.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      // 优化显示文本：方案名称优先，简洁明了，防止超长字符撑爆弹出层
      const shortName = s.name || '未命名方案';
      opt.textContent = `${shortName} · ${s.host}`;
      if (s.id === this.activeSchemaId) opt.selected = true;
      this.schemaSelect.appendChild(opt);
    });

    this.renderSchemaCapsules();
  }

  renderSchemaCapsules() {
    const container = document.getElementById('schemaCapsuleList');
    if (!container) return;
    container.innerHTML = '';

    this.schemas.forEach((s) => {
      const capsule = document.createElement('div');
      const isActive = s.id === this.activeSchemaId;
      capsule.className = `schema-capsule ${isActive ? 'active' : ''}`;
      capsule.innerHTML = `
        <span class="schema-capsule-dot"></span>
        <div class="schema-capsule-info">
          <div class="schema-capsule-name">${this.escapeHtml(s.name || '未命名')}</div>
          <div class="schema-capsule-host">${s.host}:${s.port}</div>
        </div>
      `;
      capsule.addEventListener('click', () => {
        if (s.id !== this.activeSchemaId) {
          this.onSchemaSelectChange(s.id);
        }
      });
      container.appendChild(capsule);
    });
  }

  onSchemaSelectChange(newSchemaId) {
    if (newSchemaId === this.activeSchemaId) return;

    // 【优化需求三】：选择新的 schema 之后，首先清空现有数据！
    this.clearAllData();

    this.activeSchemaId = newSchemaId;
    this.config = this.getActiveSchema();
    this.saveSchemas();
    this.applyConfigToUI();
    this.renderSchemaSelect();

    this.showToast(`已切换至: ${this.config.name}，正在清空并重连...`);
    this.restartPolling();
  }

  createNewSchema() {
    const newIdx = this.schemas.length + 1;
    const newId = 'schema_' + Date.now();
    const newSchema = {
      id: newId,
      name: `服务器方案 #${newIdx}`,
      host: '192.168.1.1',
      port: 9090,
      token: '',
      interval: 1.5,
      selectedInterface: 'auto',
    };

    this.schemas.push(newSchema);
    this.activeSchemaId = newId;
    this.config = { ...newSchema };
    this.saveSchemas();
    this.renderSchemaSelect();
    this.applyConfigToUI();
    this.clearAllData();

    this.showToast(`已新建方案，请修改下方配置并保存`);
    if (this.settingSchemaName) {
      this.settingSchemaName.focus();
      this.settingSchemaName.select();
    }
  }

  deleteCurrentSchema() {
    if (this.schemas.length <= 1) {
      this.showToast('⚠️ 至少保留一个配置方案，不可删除');
      return;
    }
    const cur = this.getActiveSchema();
    const deletedName = cur.name;

    this.schemas = this.schemas.filter((s) => s.id !== this.activeSchemaId);
    this.activeSchemaId = this.schemas[0].id;
    this.config = this.getActiveSchema();
    this.saveSchemas();

    // 清空旧数据并重新加载新方案
    this.clearAllData();
    this.applyConfigToUI();
    this.renderSchemaSelect();

    this.showToast(`已删除 [${deletedName}]，已切换至: ${this.config.name}`);
    this.restartPolling();
  }

  /* ================= 2. 清空现有数据 (Reset State) ================= */

  clearAllData() {
    // 1. 顶部 Header
    this.statusDot.className = 'status-dot connecting';
    this.statusText.textContent = `正在连接 ${this.config.name || this.config.host}...`;
    this.pingBadge.textContent = '延时: -- ms';
    this.pingBadge.style.color = '#2dce89';
    this.pingBadge.style.background = 'rgba(45, 206, 137, 0.15)';

    // 2. 英雄看板
    this.deviceHostName.textContent = '--';
    this.cpuArchBadge.textContent = '--';
    this.uptimeText.textContent = '--';
    this.loadAvgText.textContent = '0.00 / 0.00 / 0.00';
    this.clientCountBadge.textContent = '-- 台';

    // 3. CPU 状态
    this.cpuModelText.textContent = '--';
    this.cpuAvgFreq.textContent = '--';
    this.cpuCoresContainer.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px;">等待新服务器数据...</div>';

    // 4. 内存
    this.memUsagePercent.textContent = '--';
    this.memProgressFill.style.width = '0%';
    this.memDetailsText.textContent = '已用: -- / 总计: --';

    // 5. 温度
    this.tempValue.textContent = '--';
    this.tempProgressFill.style.width = '0%';
    this.tempSensorName.textContent = '传感器等待中...';

    // 6. 网络流量与 Canvas 折线图清空
    this.rxSpeedText.innerHTML = '0.0 <span style="font-size:12px;color:var(--text-muted);">KB/s</span>';
    this.txSpeedText.innerHTML = '0.0 <span style="font-size:12px;color:var(--text-muted);">KB/s</span>';
    this.rxTotalText.textContent = '累计: 0 B';
    this.txTotalText.textContent = '累计: 0 B';
    this.networkHistory.rx.fill(0);
    this.networkHistory.tx.fill(0);
    this.drawTrafficChart();

    // 7. 设备列表重置
    this.cachedClients = [];
    this.clientCountText.textContent = '共 0 台';
    this.clientListContainer.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 30px;">
        正在连接新服务器并加载设备列表...
      </div>
    `;
  }

  /* ================= 3. 常用命令预设管理 ================= */

  loadSavedCommands() {
    try {
      const saved = localStorage.getItem(STORAGE_COMMANDS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.error('Failed to load saved commands from localStorage', e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_COMMANDS));
  }

  saveSavedCommands() {
    try {
      localStorage.setItem(STORAGE_COMMANDS_KEY, JSON.stringify(this.savedCommands));
    } catch (e) {
      console.error('Failed to save commands to localStorage', e);
    }
  }

  renderCommandSelect() {
    if (!this.savedCommandSelect) return;
    this.savedCommandSelect.innerHTML = '';

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '-- 选择常用预设命令 --';
    this.savedCommandSelect.appendChild(defaultOpt);

    this.savedCommands.forEach((cmd) => {
      const opt = document.createElement('option');
      opt.value = cmd.id;
      opt.textContent = `${cmd.name}`;
      this.savedCommandSelect.appendChild(opt);
    });
  }

  onSavedCommandChange(cmdId) {
    if (!cmdId) {
      if (this.cmdPresetName) this.cmdPresetName.value = '';
      return;
    }
    const item = this.savedCommands.find((c) => c.id === cmdId);
    if (item) {
      if (this.commandInput) this.commandInput.value = item.command;
      if (this.cmdPresetName) this.cmdPresetName.value = item.name;
    }
  }

  onNewCommand() {
    const curCommand = (this.commandInput ? this.commandInput.value.trim() : '') || 'ping -c 4 192.168.1.1';
    const newIdx = this.savedCommands.length + 1;
    const name = (this.cmdPresetName && this.cmdPresetName.value.trim()) || `预设命令 #${newIdx}`;

    const newCmd = {
      id: 'cmd_' + Date.now(),
      name: name,
      command: curCommand,
    };
    this.savedCommands.push(newCmd);
    this.saveSavedCommands();
    this.renderCommandSelect();
    this.savedCommandSelect.value = newCmd.id;
    if (this.cmdPresetName) this.cmdPresetName.value = newCmd.name;
    if (this.commandInput) this.commandInput.value = newCmd.command;

    this.showToast(`✅ 已新增预设: ${newCmd.name}`);
  }

  onSaveCommandName() {
    const curId = this.savedCommandSelect.value;
    if (!curId) {
      this.onNewCommand();
      return;
    }
    const item = this.savedCommands.find((c) => c.id === curId);
    if (!item) return;

    const newName = (this.cmdPresetName ? this.cmdPresetName.value.trim() : '') || item.name;
    item.name = newName;
    if (this.commandInput && this.commandInput.value.trim()) {
      item.command = this.commandInput.value.trim();
    }
    this.saveSavedCommands();
    this.renderCommandSelect();
    this.savedCommandSelect.value = item.id;
    this.showToast(`✅ 已保存预设: ${item.name}`);
  }

  onDeleteCommand() {
    const curId = this.savedCommandSelect.value;
    if (!curId) {
      this.showToast('⚠️ 请先在下拉列表中选中要删除的预设');
      return;
    }
    const item = this.savedCommands.find((c) => c.id === curId);
    const delName = item ? item.name : '';

    this.savedCommands = this.savedCommands.filter((c) => c.id !== curId);
    this.saveSavedCommands();
    this.renderCommandSelect();
    this.savedCommandSelect.value = '';
    if (this.cmdPresetName) this.cmdPresetName.value = '';
    this.showToast(`已删除预设: ${delName}`);
  }

  /* ================= 4. 命令流式执行与防超时心跳感知 ================= */

  async executeCommand() {
    const cmd = this.commandInput.value.trim();
    if (!cmd) {
      this.showToast('⚠️ 请先输入要执行的命令');
      this.commandInput.focus();
      return;
    }

    const timeoutSec = parseInt(this.commandTimeout.value, 10) || 60;

    // 1. 切换按钮状态
    this.runCommandBtn.disabled = true;
    this.runCommandBtn.innerHTML = `
      <svg class="spin-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="margin-right:6px;animation:spin 1s linear infinite;"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
      正在执行...
    `;
    this.stopCommandBtn.style.display = 'inline-block';

    // 2. 初始化统计区
    this.cmdStatusBadge.textContent = '正在执行';
    this.cmdStatusBadge.style.color = '#11cdef';
    this.cmdStatusBadge.style.background = 'rgba(17, 205, 239, 0.15)';

    this.cmdExitCodeText.textContent = '运行中...';
    this.cmdExitCodeText.style.color = 'var(--text-muted)';
    this.cmdDetailStatusText.textContent = '进程执行中';
    this.cmdHeartbeatCount = 0;
    this.cmdHeartbeatBadge.textContent = '心跳保活: 0 次';

    // 启动秒表
    this.cmdStartTime = performance.now();
    this.cmdElapsedTime.textContent = '0.00';
    if (this.cmdTimer) clearInterval(this.cmdTimer);
    this.cmdTimer = setInterval(() => {
      const curElapsed = (performance.now() - this.cmdStartTime) / 1000;
      this.cmdElapsedTime.textContent = curElapsed.toFixed(2);
    }, 100);

    // 3. 初始化终端控制台
    this.terminalOutput.textContent = `[INIT] 正在连接服务器并提交命令: ${cmd}\n[INFO] 设定超时时间: ${timeoutSec} 秒，执行期间服务端每 5 秒自动发送心跳保活...\n------------------------------------------------------------\n`;

    this.currentCmdAbortController = new AbortController();
    const url = `${this.getBaseUrl()}/api/v1/exec`;

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          ...this.getHeaders(),
          'Content-Type': 'application/json',
          Accept: 'text/event-stream, application/json',
        },
        body: JSON.stringify({
          command: cmd,
          timeout: timeoutSec,
        }),
        signal: this.currentCmdAbortController.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errText || resp.statusText}`);
      }

      // 流式读取 SSE 事件行
      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed.startsWith('data:')) {
            const jsonStr = trimmed.slice(5).trim();
            try {
              const msg = JSON.parse(jsonStr);
              this.handleExecEvent(msg);
            } catch (err) {
              this.appendTerminalRaw(`[RAW] ${jsonStr}\n`);
            }
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        this.appendTerminalRaw('\n[CLIENT] 用户主动中止了命令执行。\n');
        this.finishCommandExecution(false, -1, '已手动中止');
      } else {
        this.appendTerminalRaw(`\n[ERROR] 请求异常: ${err.message}\n`);
        this.finishCommandExecution(false, -1, err.message);
      }
    } finally {
      this.resetCommandBtnState();
    }
  }

  handleExecEvent(msg) {
    if (msg.type === 'status') {
      // 收到服务端的 5 秒防超时心跳事件
      this.cmdHeartbeatCount += 1;
      this.cmdHeartbeatBadge.textContent = `心跳保活: ${this.cmdHeartbeatCount} 次`;
      this.cmdHeartbeatBadge.style.color = '#2dce89';
      this.cmdDetailStatusText.textContent = `执行中 (+${msg.elapsed_seconds}s 心跳)`;

      const hbLine = document.createElement('span');
      hbLine.className = 'hb-line';
      hbLine.textContent = `⏱️ [服务端心跳保活 +${msg.elapsed_seconds}s] ${msg.message}\n`;
      this.terminalOutput.appendChild(hbLine);
      this.scrollTerminalToBottom();
    } else if (msg.type === 'result') {
      // 执行完成结果
      this.finishCommandExecution(msg.success, msg.exit_code, '执行完毕', msg.elapsed_seconds);

      const headerLine = document.createElement('span');
      headerLine.className = msg.success ? 'success-line' : 'stderr-line';
      headerLine.textContent = `------------------------------------------------------------\n${
        msg.success ? '✅ [SUCCESS]' : '❌ [FAILED]'
      } 执行结束，退出码: ${msg.exit_code} (服务端耗时: ${msg.elapsed_seconds}s)\n`;
      this.terminalOutput.appendChild(headerLine);

      if (msg.stdout) {
        const outTitle = document.createElement('span');
        outTitle.style.color = 'var(--text-muted)';
        outTitle.textContent = '\n[STDOUT 标准输出]:\n';
        this.terminalOutput.appendChild(outTitle);

        const outText = document.createTextNode(msg.stdout + '\n');
        this.terminalOutput.appendChild(outText);
      }

      if (msg.stderr) {
        const errTitle = document.createElement('span');
        errTitle.className = 'stderr-line';
        errTitle.textContent = '\n[STDERR 错误输出]:\n';
        this.terminalOutput.appendChild(errTitle);

        const errSpan = document.createElement('span');
        errSpan.className = 'stderr-line';
        errSpan.textContent = msg.stderr + '\n';
        this.terminalOutput.appendChild(errSpan);
      }

      this.scrollTerminalToBottom();
    } else if (msg.type === 'error') {
      this.finishCommandExecution(false, -1, msg.message || '执行错误');
      const errSpan = document.createElement('span');
      errSpan.className = 'stderr-line';
      errSpan.textContent = `\n❌ [ERROR] ${msg.message}\n`;
      this.terminalOutput.appendChild(errSpan);
      this.scrollTerminalToBottom();
    }
  }

  appendTerminalRaw(text) {
    this.terminalOutput.appendChild(document.createTextNode(text));
    this.scrollTerminalToBottom();
  }

  scrollTerminalToBottom() {
    const parent = this.terminalOutput.parentElement;
    if (parent) parent.scrollTop = parent.scrollHeight;
  }

  stopCommandExecution() {
    if (this.currentCmdAbortController) {
      this.currentCmdAbortController.abort();
    }
  }

  finishCommandExecution(success, exitCode, detailMsg, finalServerSec = null) {
    if (this.cmdTimer) {
      clearInterval(this.cmdTimer);
      this.cmdTimer = null;
    }

    const realElapsedSec = ((performance.now() - this.cmdStartTime) / 1000).toFixed(2);
    this.cmdElapsedTime.textContent = finalServerSec ? finalServerSec.toFixed(2) : realElapsedSec;

    this.cmdExitCodeText.textContent = exitCode !== null && exitCode !== undefined ? exitCode : '--';
    this.cmdDetailStatusText.textContent = detailMsg || (success ? '成功' : '失败');

    if (success) {
      this.cmdStatusBadge.textContent = '执行成功';
      this.cmdStatusBadge.style.color = '#2dce89';
      this.cmdStatusBadge.style.background = 'rgba(45, 206, 137, 0.15)';
      this.cmdExitCodeText.style.color = '#2dce89';
    } else {
      this.cmdStatusBadge.textContent = '执行异常';
      this.cmdStatusBadge.style.color = '#f5365c';
      this.cmdStatusBadge.style.background = 'rgba(245, 54, 92, 0.15)';
      this.cmdExitCodeText.style.color = '#f5365c';
    }
  }

  resetCommandBtnState() {
    this.runCommandBtn.disabled = false;
    this.runCommandBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="margin-right: 6px;"><path d="M8 5v14l11-7z"/></svg>
      执行命令
    `;
    this.stopCommandBtn.style.display = 'none';
  }

  copyTerminalOutput() {
    const text = this.terminalOutput.innerText || this.terminalOutput.textContent;
    if (!text || text === '等待提交执行命令...') {
      this.showToast('终端暂无内容可复制');
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        this.showToast('✅ 终端输出已复制到剪贴板');
      });
    } else {
      this.showToast('⚠️ 当前浏览器不支持剪贴板操作');
    }
  }

  clearTerminalOutput() {
    this.terminalOutput.textContent = '等待提交执行命令...';
    this.cmdElapsedTime.textContent = '0.00';
    this.cmdStatusBadge.textContent = '待执行';
    this.cmdStatusBadge.style.color = 'var(--color-cyan)';
    this.cmdStatusBadge.style.background = 'rgba(17, 205, 239, 0.15)';
    this.cmdExitCodeText.textContent = '--';
    this.cmdExitCodeText.style.color = 'var(--text-muted)';
    this.cmdHeartbeatBadge.textContent = '心跳保活: 0 次';
    this.cmdDetailStatusText.textContent = '就绪';
    this.showToast('终端已清屏');
  }

  /* ================= 5. DOM 元素初始化与事件绑定 ================= */

  initElements() {
    // Top bar & status
    this.statusDot = document.getElementById('statusDot');
    this.statusText = document.getElementById('statusText');
    this.refreshBtn = document.getElementById('refreshBtn');
    this.openSettingsBtn = document.getElementById('openSettingsBtn');
    this.pingBadge = document.getElementById('pingBadge');

    // Hero
    this.deviceHostName = document.getElementById('deviceHostName');
    this.cpuArchBadge = document.getElementById('cpuArchBadge');
    this.uptimeText = document.getElementById('uptimeText');
    this.loadAvgText = document.getElementById('loadAvgText');
    this.clientCountBadge = document.getElementById('clientCountBadge');

    // CPU
    this.cpuModelText = document.getElementById('cpuModelText');
    this.cpuAvgFreq = document.getElementById('cpuAvgFreq');
    this.cpuCoresContainer = document.getElementById('cpuCoresContainer');

    // Memory
    this.memUsagePercent = document.getElementById('memUsagePercent');
    this.memProgressFill = document.getElementById('memProgressFill');
    this.memDetailsText = document.getElementById('memDetailsText');

    // Thermal
    this.tempValue = document.getElementById('tempValue');
    this.tempProgressFill = document.getElementById('tempProgressFill');
    this.tempSensorName = document.getElementById('tempSensorName');

    // Network
    this.interfaceSelect = document.getElementById('interfaceSelect');
    this.rxSpeedText = document.getElementById('rxSpeedText');
    this.txSpeedText = document.getElementById('txSpeedText');
    this.rxTotalText = document.getElementById('rxTotalText');
    this.txTotalText = document.getElementById('txTotalText');
    this.trafficCanvas = document.getElementById('trafficChart');
    this.ctx = this.trafficCanvas.getContext('2d');

    // Clients
    this.clientCountText = document.getElementById('clientCountText');
    this.clientListContainer = document.getElementById('clientListContainer');

    // Pull to Refresh Elements (监控与设备页面共享)
    this.pullRefreshContainer = document.getElementById('pullRefreshContainer');
    this.pullRefreshIcon = document.getElementById('pullRefreshIcon');
    this.pullRefreshText = document.getElementById('pullRefreshText');
    this.isPullRefreshing = false;

    // Modal & Settings Form
    this.settingsModal = document.getElementById('settingsModal');
    this.closeSettingsBtn = document.getElementById('closeSettingsBtn');
    this.settingsForm = document.getElementById('settingsForm');
    this.schemaSelect = document.getElementById('schemaSelect');
    this.newSchemaBtn = document.getElementById('newSchemaBtn');
    this.deleteSchemaBtn = document.getElementById('deleteSchemaBtn');
    this.settingSchemaName = document.getElementById('settingSchemaName');
    this.settingHost = document.getElementById('settingHost');
    this.settingPort = document.getElementById('settingPort');
    this.settingToken = document.getElementById('settingToken');
    this.settingInterval = document.getElementById('settingInterval');
    this.testConnBtn = document.getElementById('testConnBtn');
    this.testResultBox = document.getElementById('testResultBox');

    // Device Rename Modal Elements (设备自定义命名)
    this.deviceRenameModal = document.getElementById('deviceRenameModal');
    this.closeDeviceRenameBtn = document.getElementById('closeDeviceRenameBtn');
    this.deviceRenameForm = document.getElementById('deviceRenameForm');
    this.renameTargetMac = document.getElementById('renameTargetMac');
    this.renameOriginalHost = document.getElementById('renameOriginalHost');
    this.renameDeviceIp = document.getElementById('renameDeviceIp');
    this.renameDeviceMac = document.getElementById('renameDeviceMac');
    this.deviceAliasInput = document.getElementById('deviceAliasInput');
    this.clearDeviceAliasBtn = document.getElementById('clearDeviceAliasBtn');

    // Commands View Elements
    this.savedCommandSelect = document.getElementById('savedCommandSelect');
    this.newCmdBtn = document.getElementById('newCmdBtn');
    this.saveCmdNameBtn = document.getElementById('saveCmdNameBtn');
    this.deleteCmdBtn = document.getElementById('deleteCmdBtn');
    this.cmdPresetName = document.getElementById('cmdPresetName');
    this.commandInput = document.getElementById('commandInput');
    this.commandTimeout = document.getElementById('commandTimeout');
    this.runCommandBtn = document.getElementById('runCommandBtn');
    this.stopCommandBtn = document.getElementById('stopCommandBtn');

    this.cmdServerBadge = document.getElementById('cmdServerBadge');
    this.cmdStatusBadge = document.getElementById('cmdStatusBadge');
    this.cmdHeartbeatBadge = document.getElementById('cmdHeartbeatBadge');
    this.cmdElapsedTime = document.getElementById('cmdElapsedTime');
    this.cmdExitCodeText = document.getElementById('cmdExitCodeText');
    this.cmdHeartbeatText = document.getElementById('cmdHeartbeatText');
    this.cmdDetailStatusText = document.getElementById('cmdDetailStatusText');

    this.copyOutputBtn = document.getElementById('copyOutputBtn');
    this.clearOutputBtn = document.getElementById('clearOutputBtn');
    this.terminalOutput = document.getElementById('terminalOutput');

    // Toast
    this.toastMsg = document.getElementById('toastMsg');

    // Navigation & Views
    this.currentTab = 'dashboard';
    this.viewDashboard = document.getElementById('viewDashboard');
    this.viewClients = document.getElementById('viewClients');
    this.viewCommands = document.getElementById('viewCommands');
    this.navDashboard = document.getElementById('navDashboard');
    this.navClients = document.getElementById('navClients');
    this.navCommands = document.getElementById('navCommands');

    // Client search & filter
    this.clientSearchInput = document.getElementById('clientSearchInput');
    this.filterChips = document.querySelectorAll('.chip[data-filter]');
    this.clientFilter = 'all';
    this.clientSearchQuery = '';
    this.cachedClients = [];
  }

  bindEvents() {
    this.refreshBtn.addEventListener('click', () => {
      this.refreshBtn.style.transform = 'rotate(360deg)';
      setTimeout(() => (this.refreshBtn.style.transform = ''), 400);
      this.fetchStatus();
    });

    this.openSettingsBtn.addEventListener('click', () => this.openSettings());
    this.closeSettingsBtn.addEventListener('click', () => this.closeSettings());
    this.settingsModal.addEventListener('click', (e) => {
      if (e.target === this.settingsModal) this.closeSettings();
    });

    // 设备重命名弹窗事件
    if (this.closeDeviceRenameBtn) {
      this.closeDeviceRenameBtn.addEventListener('click', () => this.closeDeviceRenameModal());
    }
    if (this.deviceRenameModal) {
      this.deviceRenameModal.addEventListener('click', (e) => {
        if (e.target === this.deviceRenameModal) this.closeDeviceRenameModal();
      });
    }
    if (this.deviceRenameForm) {
      this.deviceRenameForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const mac = this.renameTargetMac.value.trim();
        const alias = this.deviceAliasInput.value.trim();
        if (mac) {
          this.setDeviceAlias(mac, alias);
          this.closeDeviceRenameModal();
          this.showToast(`✅ 已为设备保存备注: ${alias || '恢复默认'}`);
        }
      });
    }
    if (this.clearDeviceAliasBtn) {
      this.clearDeviceAliasBtn.addEventListener('click', () => {
        const mac = this.renameTargetMac.value.trim();
        if (mac) {
          this.setDeviceAlias(mac, '');
          this.closeDeviceRenameModal();
          this.showToast('已恢复默认设备名称');
        }
      });
    }

    // Schema 切换与增删
    if (this.schemaSelect) {
      this.schemaSelect.addEventListener('change', (e) => {
        this.onSchemaSelectChange(e.target.value);
      });
    }

    if (this.newSchemaBtn) {
      this.newSchemaBtn.addEventListener('click', () => this.createNewSchema());
    }

    if (this.deleteSchemaBtn) {
      this.deleteSchemaBtn.addEventListener('click', () => this.deleteCurrentSchema());
    }

    // 设置表单保存
    this.settingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const curSchema = this.getActiveSchema();
      curSchema.name = this.settingSchemaName.value.trim() || '未命名路由器';
      curSchema.host = this.settingHost.value.trim();
      curSchema.port = parseInt(this.settingPort.value, 10) || 9090;
      curSchema.token = this.settingToken.value.trim();
      curSchema.interval = parseFloat(this.settingInterval.value) || 1.5;

      // 更新到 schemas 列表
      const idx = this.schemas.findIndex((s) => s.id === this.activeSchemaId);
      if (idx !== -1) {
        this.schemas[idx] = curSchema;
      }
      this.saveSchemas();
      this.config = { ...curSchema };
      this.renderSchemaSelect();

      this.closeSettings();
      this.showToast('✅ 配置方案已保存并连接');
      this.restartPolling();
    });

    this.testConnBtn.addEventListener('click', () => this.testConnection());

    this.interfaceSelect.addEventListener('change', (e) => {
      this.config.selectedInterface = e.target.value;
      const idx = this.schemas.findIndex((s) => s.id === this.activeSchemaId);
      if (idx !== -1) {
        this.schemas[idx].selectedInterface = e.target.value;
        this.saveSchemas();
      }
      this.networkHistory.rx.fill(0);
      this.networkHistory.tx.fill(0);
    });

    // 独立选项卡切换
    this.navDashboard.addEventListener('click', () => {
      this.switchTab('dashboard');
    });

    this.navClients.addEventListener('click', () => {
      this.switchTab('clients');
    });

    if (this.navCommands) {
      this.navCommands.addEventListener('click', () => {
        this.switchTab('commands');
      });
    }

    // 命令管理事件
    if (this.savedCommandSelect) {
      this.savedCommandSelect.addEventListener('change', (e) => {
        this.onSavedCommandChange(e.target.value);
      });
    }
    if (this.newCmdBtn) {
      this.newCmdBtn.addEventListener('click', () => this.onNewCommand());
    }
    if (this.saveCmdNameBtn) {
      this.saveCmdNameBtn.addEventListener('click', () => this.onSaveCommandName());
    }
    if (this.deleteCmdBtn) {
      this.deleteCmdBtn.addEventListener('click', () => this.onDeleteCommand());
    }
    if (this.runCommandBtn) {
      this.runCommandBtn.addEventListener('click', () => this.executeCommand());
    }
    if (this.stopCommandBtn) {
      this.stopCommandBtn.addEventListener('click', () => this.stopCommandExecution());
    }
    if (this.copyOutputBtn) {
      this.copyOutputBtn.addEventListener('click', () => this.copyTerminalOutput());
    }
    if (this.clearOutputBtn) {
      this.clearOutputBtn.addEventListener('click', () => this.clearTerminalOutput());
    }

    // 设备搜索与过滤事件
    if (this.clientSearchInput) {
      this.clientSearchInput.addEventListener('input', (e) => {
        this.clientSearchQuery = e.target.value.trim().toLowerCase();
        this.renderFilteredClients();
      });
    }

    if (this.filterChips) {
      this.filterChips.forEach((btn) => {
        btn.addEventListener('click', () => {
          this.filterChips.forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          this.clientFilter = btn.dataset.filter;
          this.renderFilteredClients();
        });
      });
    }

    // 初始化监控与设备页面的下拉刷新交互
    this.initPullToRefresh();
  }

  /* ================= 6. 下拉刷新交互逻辑 (Pull to Refresh) ================= */

  initPullToRefresh() {
    if (!this.pullRefreshContainer) return;

    let startY = 0;
    let isTouching = false;
    let isPulling = false;

    const onStart = (clientY) => {
      // 仅在 监控 (dashboard) 或 设备 (clients) 视图启用下拉刷新
      if (this.currentTab !== 'dashboard' && this.currentTab !== 'clients') return;
      if (this.isPullRefreshing) return;

      // 仅当页面滚动处于最顶部时触发
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
      if (scrollTop <= 3) {
        startY = clientY;
        isTouching = true;
        isPulling = false;
      }
    };

    const onMove = (clientY, e) => {
      if (!isTouching || this.isPullRefreshing) return;
      if (this.currentTab !== 'dashboard' && this.currentTab !== 'clients') return;

      const scrollTop = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
      const diffY = clientY - startY;

      if (diffY > 0 && scrollTop <= 3) {
        isPulling = true;
        if (e && e.cancelable) e.preventDefault(); // 阻止部分移动端浏览器原生过度回弹冲突

        // 弹性阻尼计算，上限 75px
        const distance = Math.min(75, Math.pow(diffY, 0.82));
        this.pullRefreshContainer.classList.add('pulling');
        this.pullRefreshContainer.style.height = `${distance}px`;
        this.pullRefreshContainer.style.opacity = Math.min(1, distance / 35);
        this.pullRefreshContainer.style.marginBottom = `${Math.min(12, distance * 0.2)}px`;

        if (distance >= 50) {
          this.pullRefreshContainer.classList.add('ready');
          this.pullRefreshText.textContent = '释放立即更新';
        } else {
          this.pullRefreshContainer.classList.remove('ready');
          this.pullRefreshText.textContent = '下拉刷新';
        }
      } else {
        isPulling = false;
        this.pullRefreshContainer.classList.remove('pulling', 'ready');
        this.pullRefreshContainer.style.height = '0px';
        this.pullRefreshContainer.style.opacity = '0';
        this.pullRefreshContainer.style.marginBottom = '0px';
      }
    };

    const onEnd = async () => {
      if (!isTouching) return;
      isTouching = false;

      this.pullRefreshContainer.classList.remove('pulling');

      if (isPulling && this.pullRefreshContainer.classList.contains('ready')) {
        // 达到阈值，触发刷新
        this.isPullRefreshing = true;
        this.pullRefreshContainer.classList.add('refreshing');
        this.pullRefreshText.textContent = '正在获取最新数据...';
        this.pullRefreshContainer.style.height = '46px';
        this.pullRefreshContainer.style.opacity = '1';
        this.pullRefreshContainer.style.marginBottom = '12px';

        // 配合右上角刷新图标同步旋转
        if (this.refreshBtn) {
          this.refreshBtn.style.transform = 'rotate(360deg)';
        }

        try {
          await this.fetchStatus();
          this.pullRefreshText.textContent = '✅ 数据已更新';
        } catch (err) {
          this.pullRefreshText.textContent = '❌ 更新失败';
        }

        setTimeout(() => {
          if (this.refreshBtn) this.refreshBtn.style.transform = '';
          this.pullRefreshContainer.style.height = '0px';
          this.pullRefreshContainer.style.opacity = '0';
          this.pullRefreshContainer.style.marginBottom = '0px';
          this.pullRefreshContainer.classList.remove('refreshing', 'ready');
          this.isPullRefreshing = false;
        }, 500);
      } else {
        // 未达到触发阈值，平滑收缩归位
        this.pullRefreshContainer.style.height = '0px';
        this.pullRefreshContainer.style.opacity = '0';
        this.pullRefreshContainer.style.marginBottom = '0px';
        this.pullRefreshContainer.classList.remove('ready');
      }
      isPulling = false;
    };

    // 移动端 Touch 触控事件绑定
    window.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches && e.touches.length === 1) onStart(e.touches[0].clientY);
      },
      { passive: true }
    );

    window.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches && e.touches.length === 1) onMove(e.touches[0].clientY, e);
      },
      { passive: false }
    );

    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });

    // 桌面端鼠标按住下拉模拟 (方便在 PC 浏览器端直接测试验证)
    let isMouseDown = false;
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0 && e.target && e.target.closest('#mainView')) {
        isMouseDown = true;
        onStart(e.clientY);
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (isMouseDown) onMove(e.clientY, e);
    });

    window.addEventListener('mouseup', () => {
      if (isMouseDown) {
        isMouseDown = false;
        onEnd();
      }
    });
  }

  switchTab(tabName) {
    this.currentTab = tabName;
    const views = [
      { name: 'dashboard', view: this.viewDashboard, nav: this.navDashboard },
      { name: 'clients', view: this.viewClients, nav: this.navClients },
      { name: 'commands', view: this.viewCommands, nav: this.navCommands },
    ];

    views.forEach((item) => {
      if (!item.view || !item.nav) return;
      const isActive = item.name === tabName;
      item.view.classList.toggle('active', isActive);
      item.nav.classList.toggle('active', isActive);
    });

    if (tabName === 'dashboard') {
      this.initCanvas();
    } else if (tabName === 'clients') {
      this.renderFilteredClients();
    } else if (tabName === 'commands') {
      if (this.cmdServerBadge) {
        this.cmdServerBadge.textContent = `${this.config.name || 'OpenWrt'} (${this.config.host}:${this.config.port})`;
      }
    }

    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  applyConfigToUI() {
    if (this.settingSchemaName) this.settingSchemaName.value = this.config.name || '';
    this.settingHost.value = this.config.host || '';
    this.settingPort.value = this.config.port || 9090;
    this.settingToken.value = this.config.token || '';
    this.settingInterval.value = this.config.interval || 1.5;
  }

  openSettings() {
    this.applyConfigToUI();
    this.renderSchemaSelect();
    this.testResultBox.className = 'test-result-box';
    this.testResultBox.style.display = 'none';
    this.settingsModal.classList.add('open');
  }

  closeSettings() {
    this.settingsModal.classList.remove('open');
  }

  openDeviceRenameModal(mac, ip, originalHost) {
    if (!this.deviceRenameModal) return;
    this.renameTargetMac.value = mac || '';
    this.renameOriginalHost.textContent = originalHost || '未知设备';
    this.renameDeviceIp.textContent = ip || '--';
    this.renameDeviceMac.textContent = mac || '--';

    const currentAlias = this.getDeviceAlias(mac);
    this.deviceAliasInput.value = currentAlias || '';
    this.deviceRenameModal.classList.add('open');
    setTimeout(() => {
      if (this.deviceAliasInput) {
        this.deviceAliasInput.focus();
        this.deviceAliasInput.select();
      }
    }, 150);
  }

  closeDeviceRenameModal() {
    if (this.deviceRenameModal) {
      this.deviceRenameModal.classList.remove('open');
    }
  }

  showToast(message) {
    this.toastMsg.textContent = message;
    this.toastMsg.classList.add('show');
    setTimeout(() => {
      this.toastMsg.classList.remove('show');
    }, 2400);
  }

  getBaseUrl() {
    return `http://${this.config.host}:${this.config.port}`;
  }

  getHeaders() {
    const headers = { Accept: 'application/json' };
    if (this.config.token) {
      headers['Authorization'] = `Bearer ${this.config.token}`;
    }
    return headers;
  }

  async testConnection() {
    this.testConnBtn.disabled = true;
    this.testConnBtn.textContent = '正在检测...';
    this.testResultBox.className = 'test-result-box';
    this.testResultBox.style.display = 'none';

    const host = this.settingHost.value.trim();
    const port = this.settingPort.value.trim();
    const token = this.settingToken.value.trim();

    if (!host || !port) {
      this.testResultBox.className = 'test-result-box error';
      this.testResultBox.style.display = 'block';
      this.testResultBox.textContent = '❌ 请先输入有效的 IP 与端口';
      this.testConnBtn.disabled = false;
      this.testConnBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
        测试连通性
      `;
      return;
    }

    const testUrl = `http://${host}:${port}/api/v1/health`;
    const headers = { Accept: 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const t0 = performance.now();

    try {
      const resp = await fetch(testUrl, {
        headers,
        mode: 'cors',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const elapsed = Math.round(performance.now() - t0);

      this.testResultBox.style.display = 'block';
      if (resp.ok) {
        this.testResultBox.className = 'test-result-box success';
        this.testResultBox.textContent = `✅ 连接成功！HTTP ${resp.status} (耗时 ${elapsed}ms)`;
        this.showToast(`✅ 连通性测试通过 (${elapsed}ms)`);
      } else {
        this.testResultBox.className = 'test-result-box error';
        this.testResultBox.textContent = `❌ 连接异常: HTTP ${resp.status} ${resp.statusText}`;
        this.showToast(`❌ 连接异常: HTTP ${resp.status}`);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      this.testResultBox.style.display = 'block';
      this.testResultBox.className = 'test-result-box error';
      const msg = err.name === 'AbortError' ? '连接超时 (4秒未响应)' : err.message;
      this.testResultBox.textContent = `❌ 无法连接到服务器: ${msg}`;
      this.showToast(`❌ 连通失败: ${msg}`);
    } finally {
      this.testConnBtn.disabled = false;
      this.testConnBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
        测试连通性
      `;
    }
  }

  startPolling() {
    this.fetchStatus();
    const intervalMs = Math.max(500, (this.config.interval || 1.5) * 1000);
    this.timer = setInterval(() => this.fetchStatus(), intervalMs);
  }

  restartPolling() {
    if (this.timer) clearInterval(this.timer);
    this.startPolling();
  }

  async fetchStatus() {
    if (this.isPolling) return;
    this.isPolling = true;

    const url = `${this.getBaseUrl()}/api/v1/status`;
    const t0 = performance.now();

    try {
      const resp = await fetch(url, {
        headers: this.getHeaders(),
        mode: 'cors',
      });

      this.lastLatency = Math.round(performance.now() - t0);

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const res = await resp.json();
      if (res.code === 200 && res.data) {
        this.onOnline();
        this.renderData(res.data);
      } else {
        throw new Error(res.message || 'Data error');
      }
    } catch (err) {
      this.onOffline(err.message);
    } finally {
      this.isPolling = false;
    }
  }

  onOnline() {
    this.statusDot.className = 'status-dot';
    this.statusText.textContent = `已连接 (${this.config.name || this.config.host})`;
    this.pingBadge.textContent = `延时: ${this.lastLatency} ms`;
    this.pingBadge.style.color = '#2dce89';
    this.pingBadge.style.background = 'rgba(45, 206, 137, 0.15)';
  }

  onOffline(errMsg) {
    this.statusDot.className = 'status-dot offline';
    this.statusText.textContent = `连接失败 (${errMsg})`;
    this.pingBadge.textContent = '离线';
    this.pingBadge.style.color = '#f5365c';
    this.pingBadge.style.background = 'rgba(245, 54, 92, 0.15)';
  }

  renderData(data) {
    this.renderSystem(data.system, data.cpu);
    this.renderCpu(data.cpu);
    this.renderMemory(data.system);
    this.renderThermal(data.thermal);
    this.renderNetwork(data.network);
    this.renderClients(data.clients);
  }

  renderSystem(sys, cpu) {
    if (!sys) return;
    this.deviceHostName.textContent = sys.hostname || 'OpenWrt';
    this.uptimeText.textContent = sys.uptime_format || `${Math.floor(sys.uptime_seconds / 3600)} 小时`;
    this.loadAvgText.textContent = `${sys.load_avg_1.toFixed(2)} / ${sys.load_avg_5.toFixed(2)} / ${sys.load_avg_15.toFixed(2)}`;

    if (cpu) {
      this.cpuArchBadge.textContent = `${cpu.model_name.split(' ')[0]} ${cpu.cores} 核`;
    }
  }

  renderCpu(cpu) {
    if (!cpu) return;
    this.cpuModelText.textContent = cpu.model_name || 'Generic CPU';
    this.cpuAvgFreq.textContent = cpu.avg_frequency_mhz > 0 ? cpu.avg_frequency_mhz.toFixed(0) : '--';

    if (cpu.core_list && cpu.core_list.length > 0) {
      const maxFreq = Math.max(...cpu.core_list.map((c) => c.frequency_mhz), 1000);
      let html = '';
      cpu.core_list.forEach((core) => {
        const pct = Math.min(100, Math.max(5, (core.frequency_mhz / maxFreq) * 100));
        html += `
          <div class="core-item">
            <span class="core-name">Core #${core.core_id}</span>
            <div class="core-bar">
              <div class="core-fill" style="width: ${pct}%;"></div>
            </div>
            <span class="core-freq">${core.frequency_mhz > 0 ? core.frequency_mhz.toFixed(0) : '--'} MHz</span>
          </div>
        `;
      });
      this.cpuCoresContainer.innerHTML = html;
    }
  }

  renderMemory(sys) {
    if (!sys) return;
    const pct = Math.min(100, Math.max(0, sys.memory_usage_percent || 0));
    this.memUsagePercent.textContent = pct.toFixed(1);
    this.memProgressFill.style.width = `${pct}%`;

    const totalMb = (sys.total_memory_kb / 1024).toFixed(0);
    const availMb = (sys.avail_memory_kb / 1024).toFixed(0);
    const usedMb = Math.max(0, (sys.total_memory_kb - sys.avail_memory_kb) / 1024).toFixed(0);
    this.memDetailsText.textContent = `已用: ${usedMb} MB / 可用: ${availMb} MB (总计: ${totalMb} MB)`;
  }

  renderThermal(thermal) {
    if (!thermal || !thermal.sensors || thermal.sensors.length === 0) {
      this.tempValue.textContent = '--';
      this.tempProgressFill.style.width = '0%';
      this.tempSensorName.textContent = '暂无传感器';
      return;
    }

    const sensor = thermal.sensors[0];
    const temp = sensor.temperature || 0;
    this.tempValue.textContent = temp.toFixed(1);

    const pct = Math.min(100, Math.max(0, (temp / 90) * 100));
    this.tempProgressFill.style.width = `${pct}%`;

    if (temp < 55) {
      this.tempProgressFill.className = 'progress-fill green';
    } else if (temp < 75) {
      this.tempProgressFill.className = 'progress-fill orange';
    } else {
      this.tempProgressFill.className = 'progress-fill purple';
    }

    this.tempSensorName.textContent = sensor.name || '系统主传感器';
  }

  renderNetwork(network) {
    if (!network || !network.interfaces) return;
    const ifaces = network.interfaces;
    if (ifaces.length === 0) return;

    const currentSelected = this.config.selectedInterface || 'auto';
    const oldOptions = Array.from(this.interfaceSelect.options).map((o) => o.value);
    const newOptions = ['auto', ...ifaces.map((i) => i.interface)];

    if (JSON.stringify(oldOptions) !== JSON.stringify(newOptions)) {
      this.interfaceSelect.innerHTML = '';
      const autoOpt = document.createElement('option');
      autoOpt.value = 'auto';
      autoOpt.textContent = '自动选择活动网卡';
      this.interfaceSelect.appendChild(autoOpt);

      ifaces.forEach((item) => {
        const opt = document.createElement('option');
        opt.value = item.interface;
        opt.textContent = `${item.interface}`;
        this.interfaceSelect.appendChild(opt);
      });
      this.interfaceSelect.value = currentSelected;
    }

    let activeIface = null;
    if (currentSelected !== 'auto') {
      activeIface = ifaces.find((i) => i.interface === currentSelected);
    }
    if (!activeIface) {
      activeIface = ifaces.reduce((max, cur) => {
        const curTraffic = cur.rx_bytes_per_sec + cur.tx_bytes_per_sec;
        const maxTraffic = max ? max.rx_bytes_per_sec + max.tx_bytes_per_sec : -1;
        return curTraffic > maxTraffic ? cur : max;
      }, ifaces[0]);
    }

    if (!activeIface) return;

    this.rxSpeedText.innerHTML = `${this.formatSpeed(activeIface.rx_bytes_per_sec)}`;
    this.txSpeedText.innerHTML = `${this.formatSpeed(activeIface.tx_bytes_per_sec)}`;

    this.rxTotalText.textContent = `累计: ${this.formatBytes(activeIface.rx_total_bytes)}`;
    this.txTotalText.textContent = `累计: ${this.formatBytes(activeIface.tx_total_bytes)}`;

    this.networkHistory.rx.push(activeIface.rx_bytes_per_sec);
    this.networkHistory.rx.shift();
    this.networkHistory.tx.push(activeIface.tx_bytes_per_sec);
    this.networkHistory.tx.shift();

    this.drawTrafficChart();
  }

  renderClients(clientStatus) {
    if (!clientStatus) return;
    const clients = clientStatus.clients || [];
    this.cachedClients = clients;
    this.clientCountBadge.textContent = `${clientStatus.total_clients || clients.length} 台`;
    this.clientCountText.textContent = `共 ${clientStatus.total_clients || clients.length} 台`;
    this.renderFilteredClients();
  }

  renderFilteredClients() {
    if (!this.clientListContainer) return;

    let list = this.cachedClients || [];

    if (this.clientFilter !== 'all') {
      list = list.filter((c) => (c.source || '').toLowerCase() === this.clientFilter);
    }

    if (this.clientSearchQuery) {
      const q = this.clientSearchQuery;
      list = list.filter((c) => {
        const ip = (c.ip_address || '').toLowerCase();
        const mac = (c.mac_address || '').toLowerCase();
        const host = (c.hostname || '').toLowerCase();
        const alias = this.getDeviceAlias(c.mac_address).toLowerCase();
        return ip.includes(q) || mac.includes(q) || host.includes(q) || alias.includes(q);
      });
    }

    if (list.length === 0) {
      this.clientListContainer.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 40px 10px;">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="var(--card-border)" style="margin-bottom:8px;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
          <div>未找到匹配的连接设备</div>
        </div>
      `;
      return;
    }

    let html = '';
    list.forEach((c) => {
      const isDhcp = (c.source || '').toLowerCase() === 'dhcp';
      const badgeClass = isDhcp ? 'dhcp' : 'arp';
      const badgeText = isDhcp ? 'DHCP 租约' : 'ARP 邻居';
      const origName = c.hostname ? c.hostname : '未知设备';
      const ip = c.ip_address || '--';
      const mac = c.mac_address || '--';
      const expires = c.expires_at ? `租约到期: ${c.expires_at}` : '';

      // 读取用户自定义别名
      const customAlias = this.getDeviceAlias(c.mac_address);
      const displayName = customAlias || origName;

      // 图标区分：DHCP 使用工作站终端图标，ARP 使用网络接入图标
      const iconSvg = isDhcp
        ? `<svg viewBox="0 0 24 24"><path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/></svg>`
        : `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`;

      html += `
        <div class="client-card">
          <div class="client-icon ${badgeClass}">
            ${iconSvg}
          </div>
          <div class="client-info">
            <div class="client-title-row">
              <div class="client-name-wrapper" data-rename-mac="${mac}" data-rename-ip="${ip}" data-rename-host="${this.escapeHtml(origName)}" title="点击修改备注名称">
                <span class="client-name">${this.escapeHtml(displayName)}</span>
                ${customAlias ? '<span class="client-alias-tag">已备注</span>' : ''}
                <svg class="client-edit-icon" viewBox="0 0 24 24" fill="currentColor" title="修改设备名称"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
              </div>
              <span class="client-tag ${badgeClass}">${badgeText}</span>
            </div>
            <div class="client-sub-row">
              <span class="client-ip" title="点击复制 IP" data-copy-ip="${ip}">${ip}</span>
              <span style="color:var(--text-dim);font-size:10px;">•</span>
              <span class="client-mac" title="物理 MAC 地址">${mac}</span>
              ${customAlias ? `<span class="client-orig-host" title="原名: ${this.escapeHtml(origName)}">(原: ${this.escapeHtml(origName)})</span>` : ''}
            </div>
            ${expires ? `<div style="font-size:11px;color:var(--text-dim);margin-top:1px;">${expires}</div>` : ''}
          </div>
          <button type="button" class="client-copy-btn" title="复制 IP 地址" data-copy-ip="${ip}">
            <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
          </button>
        </div>
      `;
    });

    this.clientListContainer.innerHTML = html;

    // 绑定点击名称修改备注交互
    this.clientListContainer.querySelectorAll('[data-rename-mac]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const mac = el.getAttribute('data-rename-mac');
        const ip = el.getAttribute('data-rename-ip');
        const host = el.getAttribute('data-rename-host');
        if (mac && mac !== '--') {
          this.openDeviceRenameModal(mac, ip, host);
        }
      });
    });

    // 绑定 IP 快捷复制交互
    this.clientListContainer.querySelectorAll('[data-copy-ip]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const copyIp = el.getAttribute('data-copy-ip');
        if (copyIp && copyIp !== '--') {
          if (navigator.clipboard) {
            navigator.clipboard.writeText(copyIp).then(() => {
              this.showToast(`✅ 已复制 IP: ${copyIp}`);
            });
          } else {
            this.showToast(`IP: ${copyIp}`);
          }
        }
      });
    });
  }

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  formatSpeed(bytesPerSec) {
    if (bytesPerSec <= 0) {
      return `0.0 <span style="font-size:12px;color:var(--text-muted);">KB/s</span>`;
    }
    const kbps = bytesPerSec / 1024;
    if (kbps < 1024) {
      return `${kbps.toFixed(1)} <span style="font-size:12px;color:var(--text-muted);">KB/s</span>`;
    }
    const mbps = kbps / 1024;
    return `${mbps.toFixed(2)} <span style="font-size:12px;color:var(--text-muted);">MB/s</span>`;
  }

  formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let val = bytes;
    let idx = 0;
    while (val >= 1024 && idx < units.length - 1) {
      val /= 1024;
      idx++;
    }
    return `${val.toFixed(1)} ${units[idx]}`;
  }

  initCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.trafficCanvas.getBoundingClientRect();
    const width = rect.width || this.trafficCanvas.parentElement.clientWidth || 400;
    const height = 130;

    this.trafficCanvas.width = width * dpr;
    this.trafficCanvas.height = height * dpr;
    this.ctx.resetTransform?.();
    this.ctx.scale(dpr, dpr);
    this.canvasWidth = width;
    this.canvasHeight = height;
    this.drawTrafficChart();
  }

  drawTrafficChart() {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.canvasWidth || 400;
    const h = this.canvasHeight || 130;

    ctx.clearRect(0, 0, w, h);

    // 绘制背景网格虚线
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = 20; y < h; y += 30) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    const rxArr = this.networkHistory.rx;
    const txArr = this.networkHistory.tx;
    const len = rxArr.length;

    let maxVal = Math.max(...rxArr, ...txArr, 1024 * 10);
    maxVal = maxVal * 1.15;

    // 绘制 RX (下载 - 浅蓝渐变)
    this.drawSmoothCurve(ctx, rxArr, maxVal, w, h, 'rgba(17, 205, 239, 1)', 'rgba(17, 205, 239, 0.25)');

    // 绘制 TX (上传 - 绿色渐变)
    this.drawSmoothCurve(ctx, txArr, maxVal, w, h, 'rgba(45, 206, 137, 1)', 'rgba(45, 206, 137, 0.2)');
  }

  drawSmoothCurve(ctx, data, maxVal, width, height, strokeColor, fillColor) {
    const len = data.length;
    if (len < 2) return;

    const step = width / (len - 1);
    const points = [];

    for (let i = 0; i < len; i++) {
      const x = i * step;
      const y = height - (data[i] / maxVal) * (height - 15) - 5;
      points.push({ x, y });
    }

    // 曲线填充
    ctx.beginPath();
    ctx.moveTo(points[0].x, height);
    ctx.lineTo(points[0].x, points[0].y);

    for (let i = 0; i < len - 1; i++) {
      const p0 = i > 0 ? points[i - 1] : points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = i != len - 2 ? points[i + 2] : p2;

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }

    ctx.lineTo(points[len - 1].x, height);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, fillColor);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fill();

    // 曲线描边
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < len - 1; i++) {
      const p0 = i > 0 ? points[i - 1] : points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = i != len - 2 ? points[i + 2] : p2;

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// 启动客户端 App 单例
window.addEventListener('DOMContentLoaded', () => {
  window.app = new OpenWrtApp();
});
