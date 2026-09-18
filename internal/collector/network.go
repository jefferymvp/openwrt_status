package collector

import (
	"bufio"
	"context"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jefferymvp/openwrt_status/internal/model"
)

type rawNetDev struct {
	Interface string
	RxBytes   uint64
	RxPackets uint64
	RxErrors  uint64
	TxBytes   uint64
	TxPackets uint64
	TxErrors  uint64
	Timestamp time.Time
}

// NetworkSampler 负责在后台按设定间隔采样网卡流量并计算吞吐速率
type NetworkSampler struct {
	mu           sync.RWMutex
	interval     time.Duration
	lastRaw      map[string]rawNetDev
	latestStatus model.NetworkStatus
}

var (
	globalSampler *NetworkSampler
	samplerOnce   sync.Once
)

// InitNetworkSampler 初始化全局网卡采样器
func InitNetworkSampler(ctx context.Context, interval time.Duration) *NetworkSampler {
	samplerOnce.Do(func() {
		globalSampler = &NetworkSampler{
			interval: interval,
			lastRaw:  make(map[string]rawNetDev),
		}
		// 初始采样一次
		globalSampler.sample()

		// 启动后台采样协程
		go globalSampler.run(ctx)
	})
	return globalSampler
}

// GetNetworkStatus 获取最新采样的网卡时间戳与实时吞吐量
func GetNetworkStatus() model.NetworkStatus {
	if globalSampler == nil {
		// 降级：未初始化后台时直接即时读取
		raws := readProcNetDev()
		now := time.Now()
		var ifaces []model.InterfaceThroughput
		for _, r := range raws {
			ifaces = append(ifaces, model.InterfaceThroughput{
				Interface:      r.Interface,
				RxTotalBytes:   r.RxBytes,
				TxTotalBytes:   r.TxBytes,
				RxTotalPackets: r.RxPackets,
				TxTotalPackets: r.TxPackets,
				RxErrors:       r.RxErrors,
				TxErrors:       r.TxErrors,
				Timestamp:      now,
			})
		}
		return model.NetworkStatus{
			Timestamp:  now,
			Interfaces: ifaces,
		}
	}

	globalSampler.mu.RLock()
	defer globalSampler.mu.RUnlock()
	return globalSampler.latestStatus
}

func (s *NetworkSampler) run(ctx context.Context) {
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.sample()
		}
	}
}

func (s *NetworkSampler) sample() {
	now := time.Now()
	currentRaws := readProcNetDev()

	s.mu.Lock()
	defer s.mu.Unlock()

	var interfaces []model.InterfaceThroughput

	for ifaceName, current := range currentRaws {
		last, exists := s.lastRaw[ifaceName]

		var rxRate, txRate float64
		if exists && now.After(last.Timestamp) {
			durationSec := now.Sub(last.Timestamp).Seconds()
			if durationSec > 0 {
				if current.RxBytes >= last.RxBytes {
					rxRate = float64(current.RxBytes-last.RxBytes) / durationSec
				}
				if current.TxBytes >= last.TxBytes {
					txRate = float64(current.TxBytes-last.TxBytes) / durationSec
				}
			}
		}

		rxKbps := roundFloat(rxRate*8.0/1000.0, 2)
		txKbps := roundFloat(txRate*8.0/1000.0, 2)
		rxMbps := roundFloat(rxKbps/1000.0, 2)
		txMbps := roundFloat(txKbps/1000.0, 2)

		interfaces = append(interfaces, model.InterfaceThroughput{
			Interface:      ifaceName,
			RxBytesPerSec:  roundFloat(rxRate, 2),
			TxBytesPerSec:  roundFloat(txRate, 2),
			RxKBitPerSec:   rxKbps,
			TxKBitPerSec:   txKbps,
			RxMBitPerSec:   rxMbps,
			TxMBitPerSec:   txMbps,
			RxTotalBytes:   current.RxBytes,
			TxTotalBytes:   current.TxBytes,
			RxTotalPackets: current.RxPackets,
			TxTotalPackets: current.TxPackets,
			RxErrors:       current.RxErrors,
			TxErrors:       current.TxErrors,
			Timestamp:      now,
		})

		s.lastRaw[ifaceName] = current
	}

	s.latestStatus = model.NetworkStatus{
		Timestamp:  now,
		Interfaces: interfaces,
	}
}

// readProcNetDev 解析 /proc/net/dev
func readProcNetDev() map[string]rawNetDev {
	results := make(map[string]rawNetDev)

	file, err := os.Open("/proc/net/dev")
	if err != nil {
		return results
	}
	defer file.Close()

	now := time.Now()
	scanner := bufio.NewScanner(file)

	// 跳过前两行表头
	lineCount := 0
	for scanner.Scan() {
		lineCount++
		if lineCount <= 2 {
			continue
		}

		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}

		iface := strings.TrimSpace(parts[0])
		fields := strings.Fields(parts[1])
		if len(fields) < 16 {
			continue
		}

		// fields 索引:
		// [0] rx_bytes, [1] rx_packets, [2] rx_errs
		// [8] tx_bytes, [9] tx_packets, [10] tx_errs
		rxBytes, _ := strconv.ParseUint(fields[0], 10, 64)
		rxPackets, _ := strconv.ParseUint(fields[1], 10, 64)
		rxErrors, _ := strconv.ParseUint(fields[2], 10, 64)
		txBytes, _ := strconv.ParseUint(fields[8], 10, 64)
		txPackets, _ := strconv.ParseUint(fields[9], 10, 64)
		txErrors, _ := strconv.ParseUint(fields[10], 10, 64)

		results[iface] = rawNetDev{
			Interface: iface,
			RxBytes:   rxBytes,
			RxPackets: rxPackets,
			RxErrors:  rxErrors,
			TxBytes:   txBytes,
			TxPackets: txPackets,
			TxErrors:  txErrors,
			Timestamp: now,
		}
	}

	return results
}
