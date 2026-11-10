package io.github.hipiboy7.mylearningplatform;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.util.ArrayList;
import java.util.List;

/**
 * 공유(카톡 나에게·메일·드라이브)로 교환 파일을 넘기는 창구 — 앱 캐시의 share/ 폴더 파일 하나를 읽기 전용으로만 내준다.
 * 바깥에 드러나지 않고(exported=false) 공유할 때 받는 앱에만 읽기 권한을 잠깐 준다(grantUriPermissions). 쓰기·지우기는 하지 않는다.
 * MWL ShareProvider.java(MiddlewareLearner@e55b9c0)를 옮겨 고쳤다 — 이름 규칙 Policy.fileNameOk(.zip·.jsonl·.json). 문서: docs/P4_설계서_Mobile.md 3.2절
 */
public final class ShareProvider extends ContentProvider {
    static final String AUTHORITY = "io.github.hipiboy7.mylearningplatform.share";
    static final String DIR = "share";

    static Uri uriFor(String name) {
        return new Uri.Builder().scheme("content").authority(AUTHORITY).appendPath(name).build();
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    private File fileFor(Uri uri) {
        List<String> seg = uri.getPathSegments();
        if (seg.size() != 1 || getContext() == null) {
            return null;
        }
        String name = seg.get(0);
        if (!Policy.fileNameOk(name)) {
            return null;                                   // 이름 규칙 밖은 없는 것으로
        }
        File f = new File(new File(getContext().getCacheDir(), DIR), name);
        return f.isFile() ? f : null;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) {
            throw new SecurityException("읽기만 됩니다");
        }
        File f = fileFor(uri);
        if (f == null) {
            throw new FileNotFoundException(uri.toString());
        }
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File f = fileFor(uri);
        if (f == null) {
            return null;
        }
        String[] want = projection != null ? projection : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        List<String> cols = new ArrayList<>();
        List<Object> row = new ArrayList<>();
        for (String c : want) {
            if (OpenableColumns.DISPLAY_NAME.equals(c)) {
                cols.add(c);
                row.add(f.getName());
            } else if (OpenableColumns.SIZE.equals(c)) {
                cols.add(c);
                row.add(f.length());
            }
        }
        MatrixCursor cur = new MatrixCursor(cols.toArray(new String[0]), 1);
        cur.addRow(row.toArray());
        return cur;
    }

    @Override
    public String getType(Uri uri) {
        List<String> seg = uri.getPathSegments();
        return seg.size() == 1 ? Policy.fileMime(seg.get(0)) : null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("읽기만 됩니다");
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
