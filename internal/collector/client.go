package collector

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jefferymvp/openwrt_status/internal/model"
)

// DHCP 租约常见存放路径
var dhcpLeasePaths = []string{
	"/tmp/dhcp.leases",
	"/var/lib/misc/dnsmasq.leases",
	"/etc/dnsmasq/leases",
}

// GetClientStatus 获取当前连接的客户端列表及统计
func GetClientStatus() model.ClientStatus {
	clientMap := make(map[string]model.ClientItem) // MAC 地址为 key

	// 1. 解析 DHCP 租约文件
	parseDHCPLeases(clientMap)

	// 2. 解析 /proc/net/arp 补充 ARP 缓存中的局域网设备（如静态 IP 客户端）
	parseARPTable(clientMap)

	clients := make([]model.ClientItem, 0, len(clientMap))
	for _, item := range clientMap {
		clients = append(clients, item)
	}

	return model.ClientStatus{
		TotalClients: len(clients),
		Clients:      clients,
	}
}

// parseDHCPLeases 解析 dnsmasq 租约
func parseDHCPLeases(clientMap map[string]model.ClientItem) {
	for _, path := range dhcpLeasePaths {
		file, err := os.Open(path)
		if err != nil {
			continue
		}
		defer file.Close()

		now := time.Now().Unix()
		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}

			// 格式: <expiry_ts> <mac> <ip> <hostname> <client_id>
			fields := strings.Fields(line)
			if len(fields) < 4 {
				continue
			}

			expiryTs, err := strconv.ParseInt(fields[0], 10, 64)
			if err == nil && expiryTs > 0 && expiryTs < now {
				// 已过期租约忽略
				continue
			}

			mac := strings.ToLower(fields[1])
			ip := fields[2]
			hostname := fields[3]
			if hostname == "*" {
				hostname = ""
			}

			expiresAt := "Never"
			if expiryTs > 0 {
				expiresAt = time.Unix(expiryTs, 0).Format("2006-01-02 15:04:05")
			}

			clientMap[mac] = model.ClientItem{
				IPAddress:  ip,
				MACAddress: mac,
				Hostname:   hostname,
				ExpiresAt:  expiresAt,
				Source:     "dhcp",
			}
		}
		return
	}
}

// parseARPTable 解析 /proc/net/arp 表
func parseARPTable(clientMap map[string]model.ClientItem) {
	file, err := os.Open("/proc/net/arp")
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	// 跳过第一行表头
	if scanner.Scan() {
		_ = scanner.Text()
	}

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		// 格式: IP address       HW type     Flags       HW address            Mask     Device
		//       192.168.1.10     0x1         0x2         aa:bb:cc:dd:ee:ff     *        br-lan
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}

		ip := fields[0]
		flags := fields[2]
		mac := strings.ToLower(fields[3])

		// 0x2 表示已完成解析状态，过滤无效 MAC
		if flags != "0x2" || mac == "00:00:00:00:00:00" {
			continue
		}

		// 如果该客户端已有 DHCP 记录，保留 DHCP 中的 Hostname 和租约时间
		if existing, ok := clientMap[mac]; ok {
			if existing.IPAddress == "" {
				existing.IPAddress = ip
				clientMap[mac] = existing
			}
			continue
		}

		// 补充进入列表
		clientMap[mac] = model.ClientItem{
			IPAddress:  ip,
			MACAddress: mac,
			Source:     "arp",
		}
	}
}
