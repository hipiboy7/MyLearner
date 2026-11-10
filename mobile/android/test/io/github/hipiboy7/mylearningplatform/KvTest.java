package io.github.hipiboy7.mylearningplatform;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;

/**
 * 파일 KV(Kv) 시험 — 임시 폴더에서 적기·읽기·덮어쓰기·목록·지우기·이름 규칙·남은 임시 파일·크기 상한·쓸 수 없는 폴더를 본다.
 * 외부 시험 도구 없이 main 하나. scripts/build_android.sh 가 빌드마다 먼저 돌린다. 문서: docs/P4_설계서_Mobile.md 3.3·3.10절
 */
public final class KvTest {
    private static int pass;
    private static int fail;

    private static void eq(String name, Object got, Object want) {
        if (want == null ? got == null : want.equals(got)) {
            pass++;
        } else {
            fail++;
            System.out.println("FAIL " + name + ": got " + got + ", want " + want);
        }
    }

    public static void main(String[] args) throws IOException {
        File root = Files.createTempDirectory("kv-test").toFile();
        File dir = new File(root, "kv");
        Kv kv = new Kv(dir);

        eq("empty:get", kv.get("ls.mylearner.device"), null);
        eq("empty:list", kv.list("ls."), Arrays.asList());

        eq("put:ok", kv.put("ls.mylearner.device", "aaaa000000000001"), "");
        eq("put:dirMade", dir.isDirectory(), true);
        eq("get:value", kv.get("ls.mylearner.device"), "aaaa000000000001");

        String month = "{\"v\":1,\"dev\":\"aaaa\",\"summary\":\"폰에서 복습\\n둘째 줄\"}\n{\"v\":1}";
        eq("put:korean", kv.put("ls.mylearner.log.2026-11", month), "");
        eq("get:korean", kv.get("ls.mylearner.log.2026-11"), month);
        eq("put:overwrite", kv.put("ls.mylearner.log.2026-11", "새 값"), "");
        eq("get:overwrite", kv.get("ls.mylearner.log.2026-11"), "새 값");
        eq("put:empty", kv.put("kv.courses.mwl-notes", ""), "");
        eq("get:empty", kv.get("kv.courses.mwl-notes"), "");
        eq("put:backupName", kv.put("kv.backups.20261110T010000000Z-daily", "{}"), "");

        eq("list:ls", kv.list("ls."), Arrays.asList("ls.mylearner.device", "ls.mylearner.log.2026-11"));
        eq("list:kv", kv.list("kv.backups."), Arrays.asList("kv.backups.20261110T010000000Z-daily"));
        eq("list:all", kv.list("").size(), 4);
        eq("json", Kv.json(kv.list("ls.")), "[\"ls.mylearner.device\",\"ls.mylearner.log.2026-11\"]");
        eq("json:empty", Kv.json(kv.list("zz")), "[]");

        // 원자적 교체 — 임시 파일이 남지 않는다
        String[] files = dir.list();
        boolean tmpLeft = false;
        for (String f : files) {
            tmpLeft |= f.endsWith(".tmp");
        }
        eq("noTmp", tmpLeft, false);

        // 이름 규칙
        for (String bad : new String[]{null, "", ".x", "../x", "a/b", "x.tmp", "a b", "가", new String(new char[161]).replace('\0', 'a')}) {
            eq("name:" + bad, Kv.nameOk(bad), false);
            if (bad != null) {
                eq("put:bad:" + bad, kv.put(bad, "x").isEmpty(), false);
                eq("get:bad:" + bad, kv.get(bad), null);
            }
        }
        eq("name:ok", Kv.nameOk("kv.backup_text.20261110T010000000Z-import-merge"), true);
        eq("put:null", kv.put("a", null).isEmpty(), false);
        eq("put:tooBig", kv.put("a", new String(new char[Kv.MAX_CHARS + 1])).isEmpty(), false);

        // 지우기 — 없는 것도 성공
        eq("del:ok", kv.del("ls.mylearner.device"), "");
        eq("del:gone", kv.get("ls.mylearner.device"), null);
        eq("del:missing", kv.del("ls.nothing"), "");
        eq("del:bad", kv.del("../x").isEmpty(), false);

        // 쓰다 죽어 남은 임시 파일은 다음에 켤 때 지우고, 원본은 그대로
        try (FileOutputStream out = new FileOutputStream(new File(dir, "ls.mylearner.log.2026-11.deadbeef.tmp"))) {
            out.write("반쯤 쓴".getBytes(StandardCharsets.UTF_8));
        }
        Kv again = new Kv(dir);
        eq("restart:tmpGone", new File(dir, "ls.mylearner.log.2026-11.deadbeef.tmp").exists(), false);
        eq("restart:value", again.get("ls.mylearner.log.2026-11"), "새 값");
        eq("restart:list", again.list("ls."), Arrays.asList("ls.mylearner.log.2026-11"));

        // 폴더를 만들 수 없으면 이유를 돌려준다(화면이 '저장 실패' 흐름)
        File blocker = new File(root, "file-not-dir");
        try (FileOutputStream out = new FileOutputStream(blocker)) {
            out.write(1);
        }
        Kv broken = new Kv(new File(blocker, "kv"));
        eq("broken:put", broken.put("a", "x").isEmpty(), false);
        eq("broken:list", broken.list(""), Arrays.asList());

        System.out.println("KvTest " + pass + "건 통과 · 실패 " + fail + "건");
        System.exit(fail == 0 ? 0 : 1);
    }
}
