/**
 * OpenWrt Status - Argon Edition Mobile Controller
 * Robust, highly responsive, smooth Canvas visualizer & polling manager
 */

const STORAGE_KEY = 'openwrt_status_config';

// 默认配置
const DEFAULT_CONFIG = {
  host: '192.168.6.88',
  port: 9090,
  token: '',
  interval: 1.5,
  selectedInterface: 'auto',
};

class OpenWrtApp {
  constructor() {
    this.config = this.loadConfig();
    this.timer = null;
    this.isPolling = false;
    this.lastLatency = 0;
    this.networkHistory = {
      rx: new Array(30).fill(0),
      tx: new Array(30).fill(0),
    };

    this.initElements();
    this.bindEvents();
    this.applyConfigToUI();
    this.initCanvas();
    this.startPolling();
  }

  loadConfig() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : { ...DEFAULT_CONFIG };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  saveConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
    } catch (e) {
      console.error('Failed to save config to localStorage', e);
    }
  }

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

    // Modal & Settings Form
    this.settingsModal = document.getElementById('settingsModal');
    this.closeSettingsBtn = document.getElementById('closeSettingsBtn');
    this.settingsForm = document.getElementById('settingsForm');
    this.settingHost = document.getElementById('settingHost');
    this.settingPort = document.getElementById('settingPort');
    this.settingToken = document.getElementById('settingToken');
    this.settingInterval = document.getElementById('settingInterval');
    this.testConnBtn = document.getElementById('testConnBtn');
    this.testResultBox = document.getElementById('testResultBox');

    // Toast
    this.toastMsg = document.getElementById('toastMsg');

    // Navigation & Views
    this.currentTab = 'dashboard';
    this.viewDashboard = document.getElementById('viewDashboard');
    this.viewClients = document.getElementById('viewClients');
    this.navDashboard = document.getElementById('navDashboard');
    this.navClients = document.getElementById('navClients');
    this.navSettings = document.getElementById('navSettings');

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

    this.settingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveConfig({
        host: this.settingHost.value.trim(),
        port: parseInt(this.settingPort.value, 10) || 9090,
        token: this.settingToken.value.trim(),
        interval: parseFloat(this.settingInterval.value) || 1.5,
      });
      this.closeSettings();
      this.showToast('配置已保存并重新连接');
      this.restartPolling();
    });

    this.testConnBtn.addEventListener('click', () => this.testConnection());

    this.interfaceSelect.addEventListener('change', (e) => {
      this.config.selectedInterface = e.target.value;
      this.saveConfig({ selectedInterface: e.target.value });
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

    this.navSettings.addEventListener('click', () => {
      this.openSettings();
    });

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
  }

  switchTab(tabName) {
    this.currentTab = tabName;
    if (tabName === 'dashboard') {
      this.viewDashboard.classList.add('active');
      this.viewClients.classList.remove('active');
      this.navDashboard.classList.add('active');
      this.navClients.classList.remove('active');
      this.navSettings.classList.remove('active');
      // 切换回监控页时重新适配 Canvas 尺寸
      this.initCanvas();
    } else if (tabName === 'clients') {
      this.viewDashboard.classList.remove('active');
      this.viewClients.classList.add('active');
      this.navDashboard.classList.remove('active');
      this.navClients.classList.add('active');
      this.navSettings.classList.remove('active');
      this.renderFilteredClients();
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  updateActiveNav(activeId) {
    [this.navDashboard, this.navClients, this.navSettings].forEach((el) => {
      el.classList.toggle('active', el.id === activeId);
    });
  }

  applyConfigToUI() {
    this.settingHost.value = this.config.host;
    this.settingPort.value = this.config.port;
    this.settingToken.value = this.config.token || '';
    this.settingInterval.value = this.config.interval || 1.5;
  }

  openSettings() {
    this.applyConfigToUI();
    this.testResultBox.className = 'test-result-box';
    this.testResultBox.style.display = 'none';
    this.settingsModal.classList.add('open');
  }

  closeSettings() {
    this.settingsModal.classList.remove('open');
    this.updateActiveNav('navDashboard');
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
    this.statusText.textContent = `已连接 (${this.config.host})`;
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
    const pct = sys.memory_usage_percent.toFixed(1);
    this.memUsagePercent.textContent = pct;
    this.memProgressFill.style.width = `${pct}%`;

    if (pct > 85) {
      this.memProgressFill.className = 'progress-fill orange';
    } else {
      this.memProgressFill.className = 'progress-fill purple';
    }

    const usedMb = Math.round((sys.total_memory_kb - sys.avail_memory_kb) / 1024);
    const totalMb = Math.round(sys.total_memory_kb / 1024);
    this.memDetailsText.textContent = `已用: ${usedMb} MB / 总计: ${totalMb} MB`;
  }

  renderThermal(thermal) {
    if (!thermal || !thermal.sensors || thermal.sensors.length === 0) {
      this.tempValue.textContent = '--';
      return;
    }

    const sensor = thermal.sensors[0];
    const temp = sensor.temperature.toFixed(1);
    this.tempValue.textContent = temp;
    this.tempSensorName.textContent = sensor.name || 'SoC / CPU';

    // 0 ~ 100 度对应进度条
    const pct = Math.min(100, Math.max(5, (sensor.temperature / 90) * 100));
    this.tempProgressFill.style.width = `${pct}%`;

    if (sensor.temperature > 75) {
      this.tempProgressFill.className = 'progress-fill orange';
    } else {
      this.tempProgressFill.className = 'progress-fill green';
    }
  }

  renderNetwork(net) {
    if (!net || !net.interfaces || net.interfaces.length === 0) return;

    // 填充网卡选择器选项
    const currentSelected = this.interfaceSelect.value;
    const ifaceNames = net.interfaces.map((i) => i.interface);

    // 动态维护 select
    if (this.interfaceSelect.options.length !== ifaceNames.length + 1) {
      let options = `<option value="auto">自动选择活动网卡</option>`;
      ifaceNames.forEach((name) => {
        options += `<option value="${name}">${name}</option>`;
      });
      this.interfaceSelect.innerHTML = options;
      this.interfaceSelect.value = currentSelected;
    }

    // 决定选哪一个 interface 进行监控
    let target = null;
    if (this.config.selectedInterface && this.config.selectedInterface !== 'auto') {
      target = net.interfaces.find((i) => i.interface === this.config.selectedInterface);
    }

    if (!target) {
      // 优先选择有流量的物理网卡或局域网接口
      target = net.interfaces
        .filter((i) => i.interface !== 'lo')
        .sort((a, b) => (b.rx_bytes_per_sec + b.tx_bytes_per_sec) - (a.rx_bytes_per_sec + a.tx_bytes_per_sec))[0]
        || net.interfaces[0];
    }

    // 更新速率文本
    this.rxSpeedText.innerHTML = this.formatSpeed(target.rx_bytes_per_sec);
    this.txSpeedText.innerHTML = this.formatSpeed(target.tx_bytes_per_sec);

    this.rxTotalText.textContent = `累计: ${this.formatBytes(target.rx_total_bytes)}`;
    this.txTotalText.textContent = `累计: ${this.formatBytes(target.tx_total_bytes)}`;

    // 更新 Canvas 历史队列 (单位 KB/s)
    const rxKb = target.rx_bytes_per_sec / 1024;
    const txKb = target.tx_bytes_per_sec / 1024;

    this.networkHistory.rx.push(rxKb);
    this.networkHistory.rx.shift();

    this.networkHistory.tx.push(txKb);
    this.networkHistory.tx.shift();

    this.drawTrafficChart();
  }

  formatSpeed(bytesPerSec) {
    if (!bytesPerSec || bytesPerSec < 0) bytesPerSec = 0;
    if (bytesPerSec >= 1024 * 1024) {
      return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} <span style="font-size:12px;color:var(--text-muted);">MB/s</span>`;
    }
    return `${(bytesPerSec / 1024).toFixed(1)} <span style="font-size:12px;color:var(--text-muted);">KB/s</span>`;
  }

  formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }

  initCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.trafficCanvas.getBoundingClientRect();
    this.trafficCanvas.width = rect.width * dpr;
    this.trafficCanvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.drawTrafficChart();
  }

  drawTrafficChart() {
    const ctx = this.ctx;
    const rect = this.trafficCanvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    const maxVal = Math.max(
      ...this.networkHistory.rx,
      ...this.networkHistory.tx,
      10 // 最小基准高度 10 KB/s
    );

    // 绘制轻微的背景网格线
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      const y = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // 绘制 RX (绿色)
    this.drawCurve(ctx, this.networkHistory.rx, maxVal, w, h, '#2dce89', 'rgba(45, 206, 137, 0.25)');
    // 绘制 TX (紫色)
    this.drawCurve(ctx, this.networkHistory.tx, maxVal, w, h, '#5e72e4', 'rgba(94, 114, 228, 0.25)');
  }

  drawCurve(ctx, data, maxVal, w, h, strokeColor, fillGradientColor) {
    const points = data.map((val, idx) => ({
      x: (idx / (data.length - 1)) * w,
      y: h - (val / maxVal) * (h - 16) - 8,
    }));

    if (points.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 0; i < points.length - 1; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);

    // 渐变填充闭合区域
    const fillPath = new Path2D();
    fillPath.addPath(new Path2D(ctx.currentPath || ''));
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, fillGradientColor);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  renderClients(clientsData) {
    if (!clientsData) return;

    this.cachedClients = clientsData.clients || [];
    const total = clientsData.total_clients || this.cachedClients.length;
    this.clientCountBadge.textContent = `${total} 台`;
    this.clientCountText.textContent = `共 ${total} 台`;

    this.renderFilteredClients();
  }

  renderFilteredClients() {
    if (!this.cachedClients || this.cachedClients.length === 0) {
      this.clientListContainer.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 36px 16px;">
          暂无在线设备或正在拉取数据...
        </div>
      `;
      return;
    }

    let filtered = this.cachedClients;

    // 1. 类型筛选 (全部 / DHCP / ARP)
    if (this.clientFilter === 'dhcp') {
      filtered = filtered.filter((c) => c.source === 'dhcp');
    } else if (this.clientFilter === 'arp') {
      filtered = filtered.filter((c) => c.source === 'arp');
    }

    // 2. 关键词模糊搜索 (IP / MAC / 主机名)
    if (this.clientSearchQuery) {
      const q = this.clientSearchQuery;
      filtered = filtered.filter(
        (c) =>
          (c.ip_address && c.ip_address.toLowerCase().includes(q)) ||
          (c.mac_address && c.mac_address.toLowerCase().includes(q)) ||
          (c.hostname && c.hostname.toLowerCase().includes(q))
      );
    }

    if (filtered.length === 0) {
      this.clientListContainer.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 36px 16px;">
          未找到匹配 "${this.clientSearchQuery || this.clientFilter}" 的设备
        </div>
      `;
      return;
    }

    let html = '';
    filtered.forEach((c) => {
      const isDhcp = c.source === 'dhcp';
      const tagClass = isDhcp ? 'dhcp' : 'arp';
      const tagText = isDhcp ? 'DHCP 租约' : 'ARP 邻居';
      const hostDisplay = c.hostname ? c.hostname : '(未知设备名)';

      html += `
        <div class="client-card">
          <div class="client-info-left">
            <div class="client-name">
              ${hostDisplay}
              <span class="client-tag ${tagClass}">${tagText}</span>
            </div>
            <div class="client-ip">${c.ip_address}</div>
            <div class="client-mac">${c.mac_address.toUpperCase()}</div>
          </div>
          <div style="text-align: right; font-size: 11px; color: var(--text-muted);">
            ${c.expires_at ? `到期: ${c.expires_at.split(' ')[1] || c.expires_at}` : '静态/活跃'}
          </div>
        </div>
      `;
    });

    html += `<div class="list-end-hint">已显示全部 ${filtered.length} 台设备</div>`;

    this.clientListContainer.innerHTML = html;
  }
}

// 页面加载就绪后初始化应用
document.addEventListener('DOMContentLoaded', () => {
  window.owApp = new OpenWrtApp();
});
