// 풀림 업데이트 도우미 — 창 없이 돌면서 GitHub 릴리스에서 새 확장 파일을 받아 확장 폴더를 바꿔 둔다.
// 브라우저 속 풀림이 몇 분 안에 바뀐 파일을 알아채고 스스로 다시 불러온다(background.js checkDisk).
//
//   PullimHelper.exe              예약 작업 · 시작 프로그램에서: 조용히 확인 · 업데이트
//   PullimHelper.exe --startup    로그인 직후: 1분 기다렸다가 (네트워크가 잡힐 때까지)
//   PullimHelper.exe --now        시작 메뉴 '풀림 업데이트 확인': 결과를 창으로 알려 줌
//   (시험용) --dir <설치 폴더> --feed <latest.json 주소> --allow-prefix <받을 주소 앞부분> --no-delay
//
// 빌드: mcs -target:winexe -codepage:utf8 -r:System.IO.Compression.dll -r:System.IO.Compression.FileSystem.dll ...
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

[assembly: AssemblyTitle("풀림 업데이트 도우미")]
[assembly: AssemblyDescription("풀림 확장 프로그램을 GitHub 릴리스에서 자동으로 업데이트합니다")]
[assembly: AssemblyProduct("풀림")]
[assembly: AssemblyCompany("omokdie")]
[assembly: AssemblyCopyright("omokdie")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class PullimHelper
{
    // 이 도우미가 이해하는 latest.json 판. 릴리스의 minHelper 가 이보다 크면 설치 프로그램을 새로 받아야 함.
    const int HelperProtocol = 1;
    const string Repo = "omokdie/pullim";
    const string DefaultFeed = "https://github.com/" + Repo + "/releases/latest/download/latest.json";
    const string DefaultPrefix = "https://github.com/" + Repo + "/releases/download/";
    const string ReleasesPage = "https://github.com/" + Repo + "/releases/latest";
    const string Title = "풀림 업데이트";

    static string baseDir, extDir, logPath;
    static string feedUrl = DefaultFeed, allowPrefix = DefaultPrefix;
    static bool interactive, testMode;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

    [STAThread]
    static int Main(string[] args)
    {
        bool startup = false, noDelay = false;
        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            if (a == "--now") interactive = true;
            else if (a == "--startup") startup = true;
            else if (a == "--no-delay") noDelay = true;
            else if (a == "--dir" && i + 1 < args.Length) baseDir = args[++i];
            else if (a == "--feed" && i + 1 < args.Length) { feedUrl = args[++i]; testMode = true; }
            else if (a == "--allow-prefix" && i + 1 < args.Length) { allowPrefix = args[++i]; testMode = true; }
        }
        if (string.IsNullOrEmpty(baseDir))
            baseDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        baseDir = Path.GetFullPath(baseDir);
        extDir = Path.Combine(baseDir, "extension");
        logPath = Path.Combine(baseDir, "helper.log");

        if (startup && !noDelay) Thread.Sleep(60000);

        bool owned;
        using (var mutex = new Mutex(true, "Local\\PullimHelper", out owned))
        {
            if (!owned)
            {
                if (interactive) Say("이미 업데이트를 확인하고 있어요. 잠시 뒤에 다시 해 보세요.", 0x40);
                return 3;
            }
            try { return Run(); }
            catch (Exception ex)
            {
                Log("오류: " + ex.GetType().Name + ": " + ex.Message);
                if (interactive) Say("업데이트하지 못했어요.\n\n" + ex.Message + "\n\n인터넷 연결을 확인한 뒤 다시 해 보세요.", 0x10);
                return 1;
            }
            finally { try { mutex.ReleaseMutex(); } catch { } }
        }
    }

    static int Run()
    {
        try { ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; } catch { } // TLS 1.2
        try { ServicePointManager.SecurityProtocol |= (SecurityProtocolType)12288; } catch { } // TLS 1.3 (되는 곳만)
        if (testMode) WebRequest.DefaultWebProxy = null;

        string installed = ReadManifestVersion(Path.Combine(extDir, "manifest.json"));
        Log("확인 시작 — 설치된 버전 " + (installed ?? "없음") + ", " + feedUrl);

        var feed = Json.Parse(DownloadString(feedUrl)) as Dictionary<string, object>;
        if (feed == null) throw new Exception("업데이트 정보(latest.json) 모양이 이상해요");
        string latest = Str(feed, "version");
        if (!Regex.IsMatch(latest ?? "", @"^\d+(\.\d+){0,3}$")) throw new Exception("업데이트 정보의 버전이 이상해요: " + latest);

        if (installed != null && CompareVersions(latest, installed) <= 0)
        {
            Log("최신 버전 (" + installed + ")");
            if (interactive) Say("최신 버전이에요 (" + installed + ").", 0x40);
            return 0;
        }

        int minHelper = (int)Num(feed, "minHelper", 1);
        if (minHelper > HelperProtocol)
        {
            WriteInstallInfo(installed, true);
            Log("새 버전 " + latest + " 은 새 설치 프로그램이 필요함 (minHelper " + minHelper + ")");
            if (interactive && Ask("새 버전 " + latest + " 은 설치 프로그램으로 한 번 다시 설치해야 해요.\n받는 곳을 열까요?"))
                Process.Start(ReleasesPage);
            return 0;
        }

        var ext = feed.ContainsKey("extension") ? feed["extension"] as Dictionary<string, object> : null;
        if (ext == null) throw new Exception("업데이트 정보에 확장 파일이 없어요");
        string url = Str(ext, "url");
        string sha = (Str(ext, "sha256") ?? "").ToLowerInvariant();
        long size = (long)Num(ext, "size", -1);
        if (url == null || !url.StartsWith(allowPrefix, StringComparison.Ordinal) || url.Contains(".."))
            throw new Exception("받을 주소가 풀림 릴리스가 아니에요: " + url);
        if (!Regex.IsMatch(sha, "^[0-9a-f]{64}$")) throw new Exception("업데이트 정보의 SHA-256 이 이상해요");

        string staging = Path.Combine(baseDir, "staging");
        if (Directory.Exists(staging)) Directory.Delete(staging, true);
        Directory.CreateDirectory(staging);
        try
        {
            string zipPath = Path.Combine(staging, "extension.zip");
            Log("받는 중 " + url);
            DownloadFile(url, zipPath);
            long got = new FileInfo(zipPath).Length;
            if (size >= 0 && got != size) throw new Exception("받은 파일 크기가 달라요 (" + got + " ≠ " + size + ")");
            string hash = Sha256(zipPath);
            if (hash != sha) throw new Exception("받은 파일의 SHA-256 이 맞지 않아요");

            string unpacked = Path.Combine(staging, "ext");
            var files = Unzip(zipPath, unpacked);
            string newVer = ReadManifestVersion(Path.Combine(unpacked, "manifest.json"));
            if (newVer != latest) throw new Exception("받은 파일의 버전(" + newVer + ")이 업데이트 정보(" + latest + ")와 달라요");

            Apply(unpacked, files);
            WriteInstallInfo(latest, false);
            Log("업데이트 끝 " + (installed ?? "?") + " → " + latest);
            if (interactive)
                Say("풀림을 " + latest + " 로 업데이트했어요.\n\n브라우저 속 풀림은 10분 안에 스스로 새 버전을 불러와요.\n바로 쓰려면 브라우저를 껐다 켜세요.", 0x40);
            return 10;
        }
        finally
        {
            try { Directory.Delete(staging, true); } catch { }
        }
    }

    // ── 파일 바꾸기 ────────────────────────────────────────────
    // manifest.json 은 마지막에 바꿔서, 브라우저가 버전 바뀜을 볼 때는 다른 파일이 이미 다 새것이게 함
    static void Apply(string src, List<string> files)
    {
        Directory.CreateDirectory(extDir);
        var keep = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var rel in files) keep.Add(rel);
        keep.Add("install-info.json");

        foreach (var rel in files)
        {
            if (string.Equals(rel, "manifest.json", StringComparison.OrdinalIgnoreCase)) continue;
            CopyWithRetry(Path.Combine(src, rel), Path.Combine(extDir, rel));
        }
        foreach (var path in Directory.GetFiles(extDir, "*", SearchOption.AllDirectories))
        {
            string rel = path.Substring(extDir.Length).TrimStart(Path.DirectorySeparatorChar, '/').Replace('\\', '/');
            if (!keep.Contains(rel)) { try { File.Delete(path); } catch (Exception e) { Log("예전 파일을 못 지움 " + rel + ": " + e.Message); } }
        }
        foreach (var dir in Directory.GetDirectories(extDir, "*", SearchOption.AllDirectories))
        {
            try { if (Directory.Exists(dir) && Directory.GetFileSystemEntries(dir).Length == 0) Directory.Delete(dir); } catch { }
        }
        CopyWithRetry(Path.Combine(src, "manifest.json"), Path.Combine(extDir, "manifest.json"));
    }

    static void CopyWithRetry(string from, string to)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(to));
        for (int i = 0; ; i++)
        {
            try { File.Copy(from, to, true); return; }
            catch (IOException) { if (i >= 8) throw; Thread.Sleep(400); }
            catch (UnauthorizedAccessException) { if (i >= 8) throw; Thread.Sleep(400); }
        }
    }

    static List<string> Unzip(string zipPath, string dest)
    {
        var list = new List<string>();
        string root = Path.GetFullPath(dest) + Path.DirectorySeparatorChar;
        using (var zip = ZipFile.OpenRead(zipPath))
        {
            if (zip.Entries.Count > 2000) throw new Exception("압축 파일 안에 파일이 너무 많아요");
            foreach (var e in zip.Entries)
            {
                string name = e.FullName.Replace('\\', '/');
                if (name.EndsWith("/")) continue; // 폴더
                if (name.StartsWith("/") || name.Contains(":") || Array.IndexOf(name.Split('/'), "..") >= 0)
                    throw new Exception("압축 파일 안에 이상한 경로가 있어요: " + name);
                string target = Path.GetFullPath(Path.Combine(dest, name.Replace('/', Path.DirectorySeparatorChar)));
                if (!target.StartsWith(root, StringComparison.Ordinal)) throw new Exception("압축 파일 경로가 폴더 밖을 가리켜요: " + name);
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                e.ExtractToFile(target, true);
                list.Add(name);
            }
        }
        if (!list.Contains("manifest.json")) throw new Exception("압축 파일에 manifest.json 이 없어요");
        return list;
    }

    static void WriteInstallInfo(string version, bool needsSetup)
    {
        try
        {
            string json = "{\"installer\":\"setup\",\"helper\":" + HelperProtocol
                + ",\"version\":\"" + (version ?? "") + "\""
                + ",\"updatedAt\":\"" + DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture) + "\""
                + (needsSetup ? ",\"needsSetup\":true" : "") + "}";
            Directory.CreateDirectory(extDir);
            File.WriteAllText(Path.Combine(extDir, "install-info.json"), json, new UTF8Encoding(false));
        }
        catch (Exception e) { Log("install-info.json 을 못 씀: " + e.Message); }
    }

    // ── 도구 ──────────────────────────────────────────────────
    static string ReadManifestVersion(string path)
    {
        try
        {
            var m = Json.Parse(File.ReadAllText(path, Encoding.UTF8)) as Dictionary<string, object>;
            return m == null ? null : Str(m, "version");
        }
        catch { return null; }
    }

    static int CompareVersions(string a, string b)
    {
        string[] pa = a.Split('.'), pb = b.Split('.');
        for (int i = 0; i < Math.Max(pa.Length, pb.Length); i++)
        {
            int x = 0, y = 0;
            if (i < pa.Length) int.TryParse(pa[i], out x);
            if (i < pb.Length) int.TryParse(pb[i], out y);
            if (x != y) return x > y ? 1 : -1;
        }
        return 0;
    }

    static string Sha256(string path)
    {
        using (var sha = SHA256.Create())
        using (var f = File.OpenRead(path))
        {
            var sb = new StringBuilder();
            foreach (byte b in sha.ComputeHash(f)) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }
    }

    class Client : WebClient
    {
        protected override WebRequest GetWebRequest(Uri address)
        {
            var r = base.GetWebRequest(address);
            r.Timeout = 60000;
            var h = r as HttpWebRequest;
            if (h != null)
            {
                h.UserAgent = "PullimHelper/" + HelperProtocol + " (+https://github.com/" + Repo + ")";
                h.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            }
            return r;
        }
    }

    static string DownloadString(string url)
    {
        using (var c = new Client())
        {
            c.Encoding = Encoding.UTF8;
            c.Headers[HttpRequestHeader.CacheControl] = "no-cache";
            return c.DownloadString(url);
        }
    }

    static void DownloadFile(string url, string path)
    {
        using (var c = new Client()) c.DownloadFile(url, path);
    }

    static string Str(Dictionary<string, object> d, string k)
    {
        object v;
        return d.TryGetValue(k, out v) ? v as string : null;
    }

    static double Num(Dictionary<string, object> d, string k, double fallback)
    {
        object v;
        return d.TryGetValue(k, out v) && v is double ? (double)v : fallback;
    }

    static void Log(string line)
    {
        try
        {
            if (File.Exists(logPath) && new FileInfo(logPath).Length > 200 * 1024)
            {
                File.Copy(logPath, logPath + ".1", true);
                File.Delete(logPath);
            }
            File.AppendAllText(logPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + "  " + line + Environment.NewLine, new UTF8Encoding(false));
        }
        catch { }
        if (testMode) Console.WriteLine(line);
    }

    static void Say(string text, uint icon)
    {
        try { MessageBoxW(IntPtr.Zero, text, Title, icon | 0x10000); } // MB_SETFOREGROUND
        catch { Console.WriteLine("[" + Title + "] " + text); }
    }

    static bool Ask(string text)
    {
        try { return MessageBoxW(IntPtr.Zero, text, Title, 0x4 | 0x20 | 0x10000) == 6; } // 예/아니요
        catch { Console.WriteLine("[" + Title + "] " + text); return false; }
    }
}

// 아주 작은 JSON 읽개 (객체 · 배열 · 글자 · 숫자 · 참/거짓 · null)
static class Json
{
    public static object Parse(string s)
    {
        int i = 0;
        object v = Value(s, ref i);
        Ws(s, ref i);
        if (i != s.Length) throw new FormatException("JSON 뒤에 남는 글자가 있어요");
        return v;
    }

    static void Ws(string s, ref int i) { while (i < s.Length && char.IsWhiteSpace(s[i])) i++; }

    static object Value(string s, ref int i)
    {
        Ws(s, ref i);
        if (i >= s.Length) throw new FormatException("JSON 이 끝났어요");
        char c = s[i];
        if (c == '﻿') { i++; return Value(s, ref i); }
        if (c == '{')
        {
            var d = new Dictionary<string, object>();
            i++; Ws(s, ref i);
            if (i < s.Length && s[i] == '}') { i++; return d; }
            while (true)
            {
                Ws(s, ref i);
                string k = Str(s, ref i);
                Ws(s, ref i);
                if (i >= s.Length || s[i] != ':') throw new FormatException("':' 이 없어요");
                i++;
                d[k] = Value(s, ref i);
                Ws(s, ref i);
                if (i < s.Length && s[i] == ',') { i++; continue; }
                if (i < s.Length && s[i] == '}') { i++; return d; }
                throw new FormatException("객체가 닫히지 않았어요");
            }
        }
        if (c == '[')
        {
            var a = new List<object>();
            i++; Ws(s, ref i);
            if (i < s.Length && s[i] == ']') { i++; return a; }
            while (true)
            {
                a.Add(Value(s, ref i));
                Ws(s, ref i);
                if (i < s.Length && s[i] == ',') { i++; continue; }
                if (i < s.Length && s[i] == ']') { i++; return a; }
                throw new FormatException("배열이 닫히지 않았어요");
            }
        }
        if (c == '"') return Str(s, ref i);
        if (s.Length - i >= 4 && string.CompareOrdinal(s, i, "true", 0, 4) == 0) { i += 4; return true; }
        if (s.Length - i >= 5 && string.CompareOrdinal(s, i, "false", 0, 5) == 0) { i += 5; return false; }
        if (s.Length - i >= 4 && string.CompareOrdinal(s, i, "null", 0, 4) == 0) { i += 4; return null; }
        int start = i;
        while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
        if (start == i) throw new FormatException("알 수 없는 글자: " + c);
        return double.Parse(s.Substring(start, i - start), NumberStyles.Float, CultureInfo.InvariantCulture);
    }

    static string Str(string s, ref int i)
    {
        if (i >= s.Length || s[i] != '"') throw new FormatException("글자열이 아니에요");
        i++;
        var sb = new StringBuilder();
        while (i < s.Length)
        {
            char c = s[i++];
            if (c == '"') return sb.ToString();
            if (c != '\\') { sb.Append(c); continue; }
            if (i >= s.Length) break;
            char e = s[i++];
            switch (e)
            {
                case 'n': sb.Append('\n'); break;
                case 't': sb.Append('\t'); break;
                case 'r': sb.Append('\r'); break;
                case 'b': sb.Append('\b'); break;
                case 'f': sb.Append('\f'); break;
                case 'u':
                    if (i + 4 > s.Length) throw new FormatException("\\u 가 짧아요");
                    sb.Append((char)int.Parse(s.Substring(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                    i += 4;
                    break;
                default: sb.Append(e); break;
            }
        }
        throw new FormatException("글자열이 닫히지 않았어요");
    }
}
