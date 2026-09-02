# ModelEngine bulk_data 정밀도 패치 절차서

ModelEngine의 `modelengine:bulk_data`(meg client mod용 최적화 채널)는 본 translation을 **fp16**으로 보낸다.
fp16 격자는 |값|∈[512,1024)에서 0.5, [1024,2048)에서 1.0이라, 셰이더 오프셋(−1024대)을 쓰는
**플레이어모델 본**과 **고고도(y2000대) 이동 모델**의 위치가 뭉개진다. 클라(GCB모드)는 수정 불가이므로
서버 jar를 패치해 **translation 성분 |c| ≥ 512인 본만 바닐라 메타데이터(풀 정밀도) 경로로 폴백**시킨다.

⚠ **ModelEngine jar를 버전업할 때마다 이 패치를 재적용해야 한다.** (최초 적용: R4.1.0, 2026-09-02)

## 0. 전제
- ModelEngine jar는 비난독화(2026 기준). 난독화로 바뀌면 이 절차 불가 — 그때는 채널 차단(아래 8) 복원으로 롤백.
- 서버 MC 버전에 맞는 NMS 리비전 확인: 1.21.6~8 = `v1_21_R5`. (jar 안 `com/ticxo/modelengine/vX_XX_RX/` 폴더 목록으로 확인)
- 필요 도구: JDK(서버 자바 메이저 이상), IntelliJ의 fernflower(`C:\Program Files\JetBrains\IntelliJ IDEA*\plugins\java-decompiler\lib\java-decompiler.jar`),
  paperweight 캐시(해당 MC 버전으로 GCBAPI를 한 번 빌드하면 `~/.gradle/caches/paperweight-userdev/`에 생김).

## 1. 대상 클래스 추출 (작업폴더 예: WORK)
```bash
cd <플러그인폴더>   # ModelEngine-*.jar 위치
python - <<'EOF'
import zipfile
z = zipfile.ZipFile("ModelEngine-R4.1.0.jar")   # 실제 파일명으로
for n in z.namelist():
    if n.startswith('com/ticxo/modelengine/v1_21_R5/') and n.endswith('.class'):  # NMS 리비전 맞추기
        z.extract(n, r"WORK\me_full")
EOF
```

## 2. 디컴파일
```bash
java -cp "<fernflower jar>" org.jetbrains.java.decompiler.main.decompiler.ConsoleDecompiler -dgs=1 WORK/me_full WORK/me_src
# 결과: WORK/me_src/com/ticxo/modelengine/vX_XX_RX/parser/model/DisplayParser.java
```

## 3. 소스 패치 (핵심)
`DisplayParser.java`의 `sendBulkBoneData` 안, 본 순회 루프의 **바닐라 폴백 분기**를 찾는다
(R4.1.0 기준 `if (boneData.getModel().isDirty())` — 폴백은 `fallbackPackets.add(...)`로 들어가는 쪽).
버전업으로 코드가 바뀌었어도 "bulk 인코더에 넣는 분기 vs fallbackPackets에 넣는 분기" 구조를 찾으면 된다.

조건에 `|| isShaderOffsetBone(bone)` 추가:
```java
if (boneData.getModel().isDirty() || isShaderOffsetBone(bone)) {
```

헬퍼 추가 (sendBulkBoneData 바로 위):
```java
// GCB patch: 셰이더 오프셋(플레이어모델) 본은 fp16 bulk 정밀도가 부족하므로 바닐라 경로로 보낸다
private static boolean isShaderOffsetBone(DisplayBone bone) {
   org.joml.Vector3f p = bone.getPosition().get();
   return p != null && (Math.abs(p.x) >= 512.0F || Math.abs(p.y) >= 512.0F || Math.abs(p.z) >= 512.0F);
}
```
임계값 512 = 플레이어모델(−1024대)과 고고도 이동 커버. 256~512 구간 지터가 거슬리면 128로 낮춰도 됨.

## 4. 디컴파일 아티팩트 수정 (R4.1.0에서 나온 3종 — 버전 따라 다를 수 있음, 컴파일 에러 보고 대응)
- `fallbackPackets.add((Object)((u) -> ...))` → 람다에 타겟 타입: `(Object)((Packets.PacketSupplier)((u) -> ...))`
- `DataTracker var10000 = bone.getBrightness();` → `DataTracker<Integer> var10000 = ...`
- `List var10000 = this.cleanupQueue;` → `List<Runnable> var10000 = ...` (2곳)

## 5. 컴파일
```bash
# classpath: ME jar + paper dev jar(mojang-mapped, MC버전 일치) + 라이브러리들
# paper dev jar 찾기: find ~/.gradle/caches/paperweight-userdev -name output.jar -path "*applyDevBundlePatches*"
#   → jar 안 MANIFEST의 Implementation-Version으로 MC 버전 확인해 맞는 것 선택
CP="<ME jar>;<paper dev output.jar>"
CP="$CP;$(find ~/.gradle/caches/paperweight-userdev/*/work/extractFromBundler_*/minecraftLibraries -name '*.jar' | tr '\n' ';')"
CP="$CP;$(find ~/.gradle/caches/modules-2/files-2.1 \( -name 'guava-*-jre.jar' -o -name 'paper-api-*.jar' -o -name 'annotations-26*.jar' \) | grep -v sources | tr '\n' ';')"
CP="$CP;$(find ~/.gradle/caches/modules-2/files-2.1/net.kyori -name '*.jar' | grep -v sources | tr '\n' ';')"
javac -nowarn -encoding UTF-8 -cp "$CP" -d WORK/me_out WORK/me_src/.../DisplayParser.java
```

## 6. jar 교체 + 검증
```bash
python - <<'EOF'
import zipfile, os
src = "ModelEngine-R4.1.0.jar"; out = "ModelEngine-R4.1.0-patched.jar"
rep = {p: "WORK/me_out/"+p for p in [
  "com/ticxo/modelengine/v1_21_R5/parser/model/DisplayParser.class",
  "com/ticxo/modelengine/v1_21_R5/parser/model/DisplayParser$1.class"]}  # $1 등 내부클래스 전부!
zin = zipfile.ZipFile(src); zout = zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED)
for it in zin.infolist():
    zout.writestr(it.filename if it.filename not in rep else it.filename,
                  open(rep[it.filename],"rb").read() if it.filename in rep else zin.read(it.filename))
zout.close()
EOF
# 검증: javap -p 로 isShaderOffsetBone 메서드 존재 확인
```
⚠ me_out에 생성된 `DisplayParser$*.class` 내부클래스가 원본과 개수 다르면 **생성된 것 전부**를 교체 목록에 넣을 것.

## 7. 배포
1. 원본 jar 백업 (`자비스\분석\backup_modelengine_원본_<날짜>\`)
2. 패치 jar를 원래 파일명으로: 작업서버·본서버·personal 3위치 `plugins/`
3. personal 커밋·푸시
4. 재시작 후: ME 정상 enable + GCB모드 클라로 플레이어모델(32/68/70, 스킨 라이딩) 위치 확인

## 8. 연관: ModelEngineAPI.sk
`a/ModelEngineAPI.sk`에 채널 강제 차단 코드가 (주석 상태로) 있다:
`pluginMessagerChannels.remove("modelengine:bulk_data")` — 패치 불가/문제 발생 시 이 주석을 풀면
bulk 자체가 꺼져 안전한 롤백이 된다 (백업 jar 복원과 병행).
