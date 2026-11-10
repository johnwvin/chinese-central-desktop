package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"chinese-central/internal/paths"
	"chinese-central/internal/server"
)

func main() {
	port := flag.Int("port", 8821, "local port")
	root := flag.String("root", "", "folder containing bundled data")
	data := flag.String("data", "", "folder for app settings and study data")
	flag.Parse()
	if *root == "" {
		executable, err := os.Executable()
		if err != nil {
			log.Fatal(err)
		}
		*root = filepath.Dir(executable)
	}
	if *data == "" {
		config, err := os.UserConfigDir()
		if err != nil {
			log.Fatal(err)
		}
		*data = filepath.Join(config, "Chinese Central Vanilla")
	}
	if err := os.MkdirAll(filepath.Join(*data, "books"), 0700); err != nil {
		log.Fatal(err)
	}
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(*port)))
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("Chinese Central Vanilla:", listener.Addr())
	httpServer := http.Server{Handler: server.New(paths.Layout{Resource: *root, Data: *data}).Handler(), ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(httpServer.Serve(listener))
}
