// Standalone launcher: embeds the game and serves it locally, then opens the
// default browser. Build: see build.sh (cross-compiles a Windows .exe).
package main

import (
	"embed"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"time"
)

//go:embed index.html css js vendor assets
var game embed.FS

// Fixed port so campaign saves (browser localStorage is per-origin) persist between runs.
const preferredPort = 17944

func openBrowser(url string) {
	switch runtime.GOOS {
	case "windows":
		exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		exec.Command("open", url).Start()
	default:
		exec.Command("xdg-open", url).Start()
	}
}

func main() {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", preferredPort))
	if err != nil {
		// Already running? Just open the existing instance.
		url := fmt.Sprintf("http://127.0.0.1:%d/", preferredPort)
		if resp, e := http.Get(url); e == nil {
			resp.Body.Close()
			fmt.Println("Road to Berlin '44 is already running - opening it in your browser.")
			openBrowser(url)
			time.Sleep(2 * time.Second)
			return
		}
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			fmt.Println("Could not start local server:", err)
			fmt.Scanln()
			return
		}
	}
	sub, _ := fs.Sub(game, ".")
	url := fmt.Sprintf("http://%s/", ln.Addr().String())
	fmt.Println("==============================================")
	fmt.Println("  ROAD TO BERLIN '44")
	fmt.Println("==============================================")
	fmt.Println("The game is opening in your web browser.")
	fmt.Println("If it doesn't, open this address manually:")
	fmt.Println("   ", url)
	fmt.Println()
	fmt.Println("Keep this window open while you play.")
	fmt.Println("Close it to quit the game.")
	go func() { time.Sleep(400 * time.Millisecond); openBrowser(url) }()
	http.Serve(ln, http.FileServer(http.FS(sub)))
}
