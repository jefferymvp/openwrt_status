package collector

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jefferymvp/openwrt_status/internal/model"
)

// GetSystemInfo 获取系统基础状态概览
func GetSystemInfo() model.SystemInfo {
	hostname, _ := os.Hostname()
	if hostname == "" {
		hostname = "OpenWrt"
	}

	uptimeSec, uptimeStr := parseUptime()
	load1, load5, load15 := parseLoadAvg()
	totalMem, freeMem, availMem, usagePct := parseMemInfo()

	return model.SystemInfo{
		Hostname:       hostname,
		CurrentTime:    time.Now(),
		UptimeSeconds:  uptimeSec,
		UptimeFormat:   uptimeStr,
		LoadAvg1:       load1,
		LoadAvg5:       load5,
		LoadAvg15:      load15,
		TotalMemoryKB:  totalMem,
		FreeMemoryKB:   freeMem,
		AvailMemoryKB:  availMem,
		MemoryUsagePct: usagePct,
	}
}

// parseUptime 解析 /proc/uptime
func parseUptime() (int64, string) {
	content, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0, "unknown"
	}

	fields := strings.Fields(string(content))
	if len(fields) == 0 {
		return 0, "unknown"
	}

	uptimeFloat, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0, "unknown"
	}

	totalSec := int64(uptimeFloat)
	days := totalSec / 86400
	hours := (totalSec % 86400) / 3600
	minutes := (totalSec % 3600) / 60
	seconds := totalSec % 60

	var format string
	if days > 0 {
		format = fmt.Sprintf("%d天 %d小时 %d分 %d秒", days, hours, minutes, seconds)
	} else if hours > 0 {
		format = fmt.Sprintf("%d小时 %d分 %d秒", hours, minutes, seconds)
	} else {
		format = fmt.Sprintf("%d分 %d秒", minutes, seconds)
	}

	return totalSec, format
}

// parseLoadAvg 解析 /proc/loadavg
func parseLoadAvg() (float64, float64, float64) {
	content, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0, 0, 0
	}

	fields := strings.Fields(string(content))
	if len(fields) < 3 {
		return 0, 0, 0
	}

	l1, _ := strconv.ParseFloat(fields[0], 64)
	l5, _ := strconv.ParseFloat(fields[1], 64)
	l15, _ := strconv.ParseFloat(fields[2], 64)

	return roundFloat(l1, 2), roundFloat(l5, 2), roundFloat(l15, 2)
}

// parseMemInfo 解析 /proc/meminfo
func parseMemInfo() (total uint64, free uint64, avail uint64, usagePct float64) {
	file, err := os.Open("/proc/meminfo")
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}

		key := strings.TrimSpace(parts[0])
		valFields := strings.Fields(parts[1])
		if len(valFields) == 0 {
			continue
		}

		val, err := strconv.ParseUint(valFields[0], 10, 64)
		if err != nil {
			continue
		}

		switch key {
		case "MemTotal":
			total = val
		case "MemFree":
			free = val
		case "MemAvailable":
			avail = val
		}
	}

	if total > 0 {
		var used uint64
		if avail > 0 {
			used = total - avail
		} else {
			used = total - free
		}
		usagePct = roundFloat((float64(used)/float64(total))*100.0, 1)
	}

	return
}
