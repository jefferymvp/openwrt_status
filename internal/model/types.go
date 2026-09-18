package model

import "time"

// BaseResponse 统一接口基础结构
type BaseResponse struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

// CPUCoreInfo 单个核心频率信息
type CPUCoreInfo struct {
	CoreID       int     `json:"core_id"`
	FrequencyMHz float64 `json:"frequency_mhz"`
}

// CPUStatus CPU 状态信息
type CPUStatus struct {
	ModelName string        `json:"model_name"`
	Cores     int           `json:"cores"`
	AvgFreq   float64       `json:"avg_frequency_mhz"`
	CoreList  []CPUCoreInfo `json:"core_list"`
}

// ThermalItem 单个温度传感器数据
type ThermalItem struct {
	Name        string  `json:"name"`
	Temperature float64 `json:"temperature"` // 摄氏度
	Type        string  `json:"type,omitempty"`
}

// ThermalStatus 系统温度列表
type ThermalStatus struct {
	Sensors []ThermalItem `json:"sensors"`
}

// ClientItem 客户端信息
type ClientItem struct {
	IPAddress  string `json:"ip_address"`
	MACAddress string `json:"mac_address"`
	Hostname   string `json:"hostname,omitempty"`
	ExpiresAt  string `json:"expires_at,omitempty"`
	Source     string `json:"source"` // "dhcp" 或 "arp"
}

// ClientStatus 连接客户端统计
type ClientStatus struct {
	TotalClients int          `json:"total_clients"`
	Clients      []ClientItem `json:"clients"`
}

// InterfaceThroughput 单个网络接口的吞吐量与累计流量
type InterfaceThroughput struct {
	Interface string `json:"interface"`

	// 实时吞吐速率 (计算窗口内平均值)
	RxBytesPerSec float64 `json:"rx_bytes_per_sec"`
	TxBytesPerSec float64 `json:"tx_bytes_per_sec"`
	RxKBitPerSec  float64 `json:"rx_kbps"`
	TxKBitPerSec  float64 `json:"tx_kbps"`
	RxMBitPerSec  float64 `json:"rx_mbps"`
	TxMBitPerSec  float64 `json:"tx_mbps"`

	// 累计流量与数据包
	RxTotalBytes   uint64 `json:"rx_total_bytes"`
	TxTotalBytes   uint64 `json:"tx_total_bytes"`
	RxTotalPackets uint64 `json:"rx_total_packets"`
	TxTotalPackets uint64 `json:"tx_total_packets"`
	RxErrors       uint64 `json:"rx_errors"`
	TxErrors       uint64 `json:"tx_errors"`

	// 采样时间戳
	Timestamp time.Time `json:"timestamp"`
}

// NetworkStatus 网络接口状态集合
type NetworkStatus struct {
	Timestamp  time.Time             `json:"timestamp"`
	Interfaces []InterfaceThroughput `json:"interfaces"`
}

// SystemInfo 系统基础概览
type SystemInfo struct {
	Hostname       string    `json:"hostname"`
	CurrentTime    time.Time `json:"current_time"`
	UptimeSeconds  int64     `json:"uptime_seconds"`
	UptimeFormat   string    `json:"uptime_format"`
	LoadAvg1       float64   `json:"load_avg_1"`
	LoadAvg5       float64   `json:"load_avg_5"`
	LoadAvg15      float64   `json:"load_avg_15"`
	TotalMemoryKB  uint64    `json:"total_memory_kb"`
	FreeMemoryKB   uint64    `json:"free_memory_kb"`
	AvailMemoryKB  uint64    `json:"avail_memory_kb"`
	MemoryUsagePct float64   `json:"memory_usage_percent"`
}

// AllStatusResponse 聚合全量状态数据
type AllStatusResponse struct {
	System    SystemInfo    `json:"system"`
	CPU       CPUStatus     `json:"cpu"`
	Thermal   ThermalStatus `json:"thermal"`
	Clients   ClientStatus  `json:"clients"`
	Network   NetworkStatus `json:"network"`
}
