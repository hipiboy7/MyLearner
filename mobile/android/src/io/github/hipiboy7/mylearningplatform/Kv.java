package io.github.hipiboy7.mylearningplatform;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.StandardOpenOption;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.regex.Pattern;

/**
 * 파일 KV — 화면의 안드로이드 저장 어댑터(web/store/android.js)가 다리(MainActivity.Bridge kv*)로 쓰는 앱 전용 파일 저장소. 파일 하나 = 이름 하나.
 * 왜: WebView 의 localStorage 는 쓴 뒤 몇 초 모아 디스크에 적어, 그 사이 앱이 죽으면(최근 앱에서 지우기·강제 종료) 마지막 기록이 사라졌다
 * (MWL 에뮬레이터 실측 — MWL docs/설계서_Architecture.md 6.6). 쓰기는 임시 파일 → fsync → 이름 바꾸기(원자적 교체)라 put 이 돌아오면 디스크에 있다.
 * 계산하지 않는다 — 받은 글을 그대로 둔다. 안드로이드 API 를 쓰지 않아 JVM 에서 시험한다(test/.../KvTest.java).
 * 쓰기는 MWL Mirror.java(MiddlewareLearner@e55b9c0)의 원자적 쓰기를 옮겼다. 문서: docs/P4_설계서_Mobile.md 3.3절
 */
final class Kv {
    /** 값 하나의 상한(UTF-16 글자 수) — 64 MiB 남짓. 기록 한 달·백업 하나가 이보다 훨씬 작다 */
    static final int MAX_CHARS = 32 * 1024 * 1024;
    private static final Pattern NAME = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,159}");
    private static final SecureRandom RANDOM = new SecureRandom();
    private final File dir;

    Kv(File dir) {
        this.dir = dir;
        File[] left = dir.listFiles();
        if (left != null) {
            for (File f : left) {
                if (f.getName().endsWith(".tmp")) {
                    f.delete();                          // 쓰다 죽은 임시 파일 — 원본은 그대로다
                }
            }
        }
    }

    static boolean nameOk(String name) {
        return name != null && NAME.matcher(name).matches() && !name.endsWith(".tmp");
    }

    /** 적힌 값. 이름이 틀렸거나 없거나 읽을 수 없으면 null */
    synchronized String get(String name) {
        if (!nameOk(name)) {
            return null;
        }
        File f = new File(dir, name);
        if (!f.isFile()) {
            return null;
        }
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] b = new byte[1 << 16];
            int n;
            while ((n = in.read(b)) > 0) {
                buf.write(b, 0, n);
            }
            return new String(buf.toByteArray(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            return null;
        }
    }

    /** 원자적으로 적는다. 성공하면 "", 아니면 이유(화면이 '저장 실패' 띠를 띄우고 다시 보낸다) */
    synchronized String put(String name, String value) {
        if (!nameOk(name)) {
            return "이름이 틀렸다";
        }
        if (value == null || value.length() > MAX_CHARS) {
            return "값이 없거나 너무 크다";
        }
        if (!dir.isDirectory() && !dir.mkdirs()) {
            return "저장 폴더를 만들 수 없다";
        }
        File tmp = new File(dir, name + "." + Long.toHexString(RANDOM.nextLong() & 0xFFFFFFFFL) + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(value.getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        } catch (IOException e) {
            tmp.delete();
            return "쓰지 못했다(" + e.getMessage() + ")";
        }
        if (!tmp.renameTo(new File(dir, name))) {
            tmp.delete();
            return "바꿔 넣지 못했다";
        }
        syncDir();
        return "";
    }

    /** 지운다. 없으면 그대로 성공 */
    synchronized String del(String name) {
        if (!nameOk(name)) {
            return "이름이 틀렸다";
        }
        File f = new File(dir, name);
        if (f.exists() && !f.delete()) {
            return "지우지 못했다";
        }
        syncDir();
        return "";
    }

    /** 그 접두사로 시작하는 이름들(이름순) */
    synchronized List<String> list(String prefix) {
        List<String> out = new ArrayList<>();
        String[] names = dir.list();
        if (names != null) {
            for (String n : names) {
                if (nameOk(n) && n.startsWith(prefix == null ? "" : prefix) && new File(dir, n).isFile()) {
                    out.add(n);
                }
            }
        }
        Collections.sort(out);
        return out;
    }

    /** 이름 목록 → JSON 배열 글(이름 규칙상 따옴표·역슬래시가 없지만 그래도 감싼다) */
    static String json(List<String> names) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < names.size(); i++) {
            if (i > 0) {
                b.append(',');
            }
            b.append('"').append(names.get(i).replace("\\", "\\\\").replace("\"", "\\\"")).append('"');
        }
        return b.append(']').toString();
    }

    /** 폴더 자체도 fsync — 이름 바꾸기가 디스크에 남게(되는 곳에서만. 안 되면 넘어간다) */
    private void syncDir() {
        try (FileChannel ch = FileChannel.open(dir.toPath(), StandardOpenOption.READ)) {
            ch.force(true);
        } catch (IOException | RuntimeException e) {
            // 어떤 파일 시스템은 폴더를 열 수 없다 — 파일 fsync 와 이름 바꾸기로 충분하다
        }
    }
}
