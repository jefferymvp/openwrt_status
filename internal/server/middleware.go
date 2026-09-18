package server

import (
	"log"
	"net/http"
	"strings"
	"time"
)

// Middleware 中间件函数类型
type Middleware func(http.Handler) http.Handler

// Chain 将多个中间件链接起来
func Chain(h http.Handler, middlewares ...Middleware) http.Handler {
	for i := len(middlewares) - 1; i >= 0; i-- {
		h = middlewares[i](h)
	}
	return h
}

// CORSMiddleware 处理跨域请求
func CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// AuthMiddleware 提供可选的 Token 鉴权
func AuthMiddleware(requiredToken string) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// 未设置 Token 时直接放行
			if requiredToken == "" {
				next.ServeHTTP(w, r)
				return
			}

			// 健康检查接口放行
			if r.URL.Path == "/api/v1/health" {
				next.ServeHTTP(w, r)
				return
			}

			// 检查 Header 中的 Bearer Token
			authHeader := r.Header.Get("Authorization")
			token := ""
			if strings.HasPrefix(authHeader, "Bearer ") {
				token = strings.TrimPrefix(authHeader, "Bearer ")
			} else if qToken := r.URL.Query().Get("token"); qToken != "" {
				token = qToken
			}

			if token != requiredToken {
				w.Header().Set("Content-Type", "application/json; charset=utf-8")
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"code":401,"message":"Unauthorized: invalid or missing token"}`))
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// LoggingAndRecoveryMiddleware 记录请求日志并防止 panic 崩溃
func LoggingAndRecoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		defer func() {
			if err := recover(); err != nil {
				log.Printf("[PANIC RECOVER] %v\n", err)
				w.Header().Set("Content-Type", "application/json; charset=utf-8")
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = w.Write([]byte(`{"code":500,"message":"Internal Server Error"}`))
			}
		}()

		next.ServeHTTP(w, r)

		log.Printf("[%s] %s %s (%v)", r.Method, r.RequestURI, r.RemoteAddr, time.Since(start))
	})
}
