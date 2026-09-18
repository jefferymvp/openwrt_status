package collector

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/jefferymvp/openwrt_status/internal/model"
)

// GetThermalStatus 获取系统所有温度传感器的温度数据
func GetThermalStatus() model.ThermalStatus {
	sensors := make([]model.ThermalItem, 0)

	// 1. 读取 /sys/class/thermal/thermal_zone*
	tzSensors := readThermalZones()
	sensors = append(sensors, tzSensors...)

	// 2. 读取 /sys/class/hwmon/hwmon*
	hwmonSensors := readHwmon()
	sensors = append(sensors, hwmonSensors...)

	return model.ThermalStatus{
		Sensors: sensors,
	}
}

// readThermalZones 从 /sys/class/thermal/thermal_zone* 读取温度
func readThermalZones() []model.ThermalItem {
	zones, err := filepath.Glob("/sys/class/thermal/thermal_zone*")
	if err != nil || len(zones) == 0 {
		return nil
	}

	var results []model.ThermalItem
	for _, zoneDir := range zones {
		zoneName := filepath.Base(zoneDir)

		// 读取传感器类型名（如 cpu-thermal、soc-thermal）
		typeName := readStringFile(filepath.Join(zoneDir, "type"))
		if typeName == "" {
			typeName = zoneName
		}

		rawTemp := readFirstIntFromFile(filepath.Join(zoneDir, "temp"))
		if rawTemp <= 0 {
			continue
		}

		celsius := normalizeTemperature(rawTemp)
		results = append(results, model.ThermalItem{
			Name:        fmt.Sprintf("%s (%s)", typeName, zoneName),
			Temperature: celsius,
			Type:        "thermal_zone",
		})
	}

	return results
}

// readHwmon 从 /sys/class/hwmon/hwmon* 读取硬件传感器温度
func readHwmon() []model.ThermalItem {
	hwmons, err := filepath.Glob("/sys/class/hwmon/hwmon*")
	if err != nil || len(hwmons) == 0 {
		return nil
	}

	var results []model.ThermalItem
	for _, hwmonDir := range hwmons {
		hwmonName := readStringFile(filepath.Join(hwmonDir, "name"))
		if hwmonName == "" {
			hwmonName = filepath.Base(hwmonDir)
		}

		tempInputs, _ := filepath.Glob(filepath.Join(hwmonDir, "temp*_input"))
		for _, tempFile := range tempInputs {
			base := filepath.Base(tempFile) // 例如 temp1_input
			idx := strings.TrimSuffix(strings.TrimPrefix(base, "temp"), "_input")

			// 读取 label 文件（如 temp1_label）
			label := readStringFile(filepath.Join(hwmonDir, fmt.Sprintf("temp%s_label", idx)))
			if label == "" {
				label = fmt.Sprintf("Sensor %s", idx)
			}

			rawTemp := readFirstIntFromFile(tempFile)
			if rawTemp <= 0 {
				continue
			}

			celsius := normalizeTemperature(rawTemp)
			results = append(results, model.ThermalItem{
				Name:        fmt.Sprintf("%s - %s", hwmonName, label),
				Temperature: celsius,
				Type:        "hwmon",
			})
		}
	}

	return results
}

// normalizeTemperature 标准化温度值为摄氏度
func normalizeTemperature(raw int64) float64 {
	// Linux 内核驱动常规以毫摄氏度 (m°C) 呈现，如 45000 代表 45°C
	if raw > 1000 {
		return roundFloat(float64(raw)/1000.0, 1)
	}
	return roundFloat(float64(raw), 1)
}

// readStringFile 读取单行文本文件内容
func readStringFile(path string) string {
	content, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(content))
}
