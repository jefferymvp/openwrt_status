package collector

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"

	"github.com/jefferymvp/openwrt_status/internal/model"
)

// GetCPUStatus 获取 CPU 状态（型号、核心数、各核心频率及平均频率）
func GetCPUStatus() model.CPUStatus {
	status := model.CPUStatus{
		Cores:    runtime.NumCPU(),
		CoreList: make([]model.CPUCoreInfo, 0),
	}

	// 1. 尝试从 sysfs 读取 cpufreq (/sys/devices/system/cpu/cpu*/cpufreq/)
	coreFreqs := readSysfsCPUFreq()

	// 2. 解析 /proc/cpuinfo 获取型号与补充频率信息
	modelName, cpuinfoFreqs := parseProcCPUInfo()
	if modelName != "" {
		status.ModelName = modelName
	} else {
		status.ModelName = fmt.Sprintf("%s (%d Cores)", runtime.GOARCH, runtime.NumCPU())
	}

	// 如果 sysfs 读取到了各核频率，则优先使用 sysfs
	if len(coreFreqs) > 0 {
		status.CoreList = coreFreqs
	} else if len(cpuinfoFreqs) > 0 {
		status.CoreList = cpuinfoFreqs
	} else {
		// 未找到动态频率驱动时，至少提供逻辑核心基础信息
		for i := 0; i < runtime.NumCPU(); i++ {
			status.CoreList = append(status.CoreList, model.CPUCoreInfo{
				CoreID:       i,
				FrequencyMHz: 0,
			})
		}
	}

	status.Cores = len(status.CoreList)
	if status.Cores == 0 {
		status.Cores = runtime.NumCPU()
	}

	// 计算平均频率
	var totalFreq float64
	validCount := 0
	for _, core := range status.CoreList {
		if core.FrequencyMHz > 0 {
			totalFreq += core.FrequencyMHz
			validCount++
		}
	}
	if validCount > 0 {
		status.AvgFreq = roundFloat(totalFreq/float64(validCount), 2)
	}

	return status
}

// readSysfsCPUFreq 从 /sys/devices/system/cpu/cpu*/cpufreq 读取各核实时频率
func readSysfsCPUFreq() []model.CPUCoreInfo {
	matches, err := filepath.Glob("/sys/devices/system/cpu/cpu[0-9]*")
	if err != nil || len(matches) == 0 {
		return nil
	}

	var results []model.CPUCoreInfo
	cpuRegex := regexp.MustCompile(`cpu(\d+)$`)

	for _, cpuDir := range matches {
		subMatch := cpuRegex.FindStringSubmatch(filepath.Base(cpuDir))
		if len(subMatch) < 2 {
			continue
		}
		coreID, err := strconv.Atoi(subMatch[1])
		if err != nil {
			continue
		}

		freqKHz := readFirstIntFromFile(
			filepath.Join(cpuDir, "cpufreq", "scaling_cur_freq"),
			filepath.Join(cpuDir, "cpufreq", "cpuinfo_cur_freq"),
		)

		if freqKHz > 0 {
			results = append(results, model.CPUCoreInfo{
				CoreID:       coreID,
				FrequencyMHz: roundFloat(float64(freqKHz)/1000.0, 2),
			})
		}
	}

	return results
}

// parseProcCPUInfo 解析 /proc/cpuinfo
func parseProcCPUInfo() (string, []model.CPUCoreInfo) {
	file, err := os.Open("/proc/cpuinfo")
	if err != nil {
		return "", nil
	}
	defer file.Close()

	var modelName string
	var freqs []model.CPUCoreInfo
	currentCoreID := -1
	var currentFreq float64

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			if currentCoreID >= 0 && currentFreq > 0 {
				freqs = append(freqs, model.CPUCoreInfo{
					CoreID:       currentCoreID,
					FrequencyMHz: roundFloat(currentFreq, 2),
				})
				currentCoreID = -1
				currentFreq = 0
			}
			continue
		}

		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}

		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])

		// 匹配 CPU 型号
		if modelName == "" {
			switch strings.ToLower(key) {
			case "model name", "system type", "cpu model", "hardware", "processor":
				if !strings.HasPrefix(strings.ToLower(key), "processor") || !isDigits(val) {
					modelName = val
				}
			}
		}

		// 匹配处理器核编号
		if strings.ToLower(key) == "processor" {
			if id, err := strconv.Atoi(val); err == nil {
				currentCoreID = id
			}
		}

		// 匹配频率相关项
		switch strings.ToLower(key) {
		case "cpu mhz":
			if f, err := strconv.ParseFloat(val, 64); err == nil {
				currentFreq = f
			}
		case "bogomips":
			// 某些 MIPS 路由器只有 BogoMIPS，作为兜底
			if currentFreq == 0 {
				if f, err := strconv.ParseFloat(val, 64); err == nil {
					currentFreq = f
				}
			}
		}
	}

	if currentCoreID >= 0 && currentFreq > 0 {
		freqs = append(freqs, model.CPUCoreInfo{
			CoreID:       currentCoreID,
			FrequencyMHz: roundFloat(currentFreq, 2),
		})
	}

	return modelName, freqs
}

// readFirstIntFromFile 尝试从多个候选路径中读取第一个成功的整数
func readFirstIntFromFile(paths ...string) int64 {
	for _, p := range paths {
		content, err := os.ReadFile(p)
		if err == nil {
			str := strings.TrimSpace(string(content))
			if val, err := strconv.ParseInt(str, 10, 64); err == nil {
				return val
			}
		}
	}
	return 0
}

func isDigits(s string) bool {
	_, err := strconv.Atoi(s)
	return err == nil
}

func roundFloat(val float64, precision int) float64 {
	ratio := 1.0
	for i := 0; i < precision; i++ {
		ratio *= 10
	}
	return float64(int(val*ratio+0.5)) / ratio
}
