# モデル切り替え用引き継ぎ

## 2026-10-25：一括承認（本番反映準備）
- Admin-only bulk approval: count 1–100 or inclusive JST end date; shortcuts10/100/today+7days. Future-dated drafts sorted by scheduled_at/created_at/id. Per-post checkboxes/body disclosure. Preview excludes duplicate slots/daily7 capacity; final explicit approval activates automatic publication.
- SQL013_bulk_approval.sql APPLIED ONCE. Exact post IDs + versions, atomic transaction, existing mutate_post audit/quota checks, row locks and request UUID replay safety. All service_role-only/RLS. No new keys or permissions.
- 67 Node tests PASS. test/bulk-approval-invariants.sql live rolled-back transaction PASS: date/count/exclusions/version conflict rollback, successful2 approval, replay safety, daily7 atomic rollback, admin-only. All test reservations rolled back; real drafts not approved. Pending deployment and browser preview verification; do not click real bulk approve for verification.

更新: 2026-10-24 JST。GPT-6 astra → GPT-6.1 sol。同じチャットで続行する前提。秘密キー・パスワードはこの文書に含まない。

## 2026-10-24 プロンプト管理・テスト生成（最新）
ユーザー依頼: 投稿品質を高めるため、複数プロンプトの設定・試し生成・共感/教育などテーマ別の使い分け。初期版は既存Make/OpenAIを利用し15分確認、テストを公開しない仕様で実装。
b0ab67a / Deploy #12成功 https://github.com/hasehasehaseha/Threads-Automation/actions/runs/40103642290 。SQL006適用済み。prompt_templates/planを追加、generation_jobsにkind/test、prompt_snapshot、preview_postsを追加。通常生成のtarget_date一意は維持し、testはtarget_date null。SQL complete_generation_jobでtestをpreview_postsだけに保存、通常は未承認draftのみ作成。
個別指示はsrc/prompts.jsで入力検証。generationPrompt(settings,snapshot)が共通方針＋個別指示を結合。Makeのjob{id,claim_id,prompt}とresult契約を維持し、シナリオや認証の変更は不要。Workerにprompts保存・plan保存・test依頼・指示全文preview API。public/prompts.jsが編集/一覧/割当/履歴/15秒ポーリング/下書きへの採用を担当。
管理者だけが保存・使い分け変更。編集スタッフも未保存の指示をテスト可能。テストは1人同時1件・1時間10回まで。新しい権限付与や秘密キー作成は行っていない。
初期4テンプレート（共感、学び、教室紹介、体験前の安心）、デフォルト割当は共感/学び/教室紹介。保存・使い分け保存のUI操作成功。共感テンプレートは内容を変えず保存確認したのでversionが進んでいる。
23:44 JSTにUIで未保存の個別指示をテスト依頼、job 78892229-8925-4c25-888a-7cd57ade2650。23:45頃Make Run onceで実OpenAI生成成功。3案全て指定冒頭「習い事、いつ始めよう？」、URLなし補足も反映。DB postsは前後7件で不変。次に案1だけ日時未指定・未承認の下書きとして採用しUI表示を確認。公開なし。テスト履歴・指示スナップショットは保存済み。現在の共感編集欄にはこの未保存テスト入力が残っているが、ライブラリの保存指示は変更していない。
38 Nodeテスト成功。test/prompt-invariants.sqlのDB実機rollback検証で、テストの投稿隔離・依頼時snapshot不変・通常生成draftのみ・callback再送の冪等性・公開ロール制限も成功。
77e101bで仕上げ: 下書き採用後すぐstate更新、同じ画面内の採用済み表示維持、割当編集中のversion固定で他スタッフの更新を上書きしない、旧投稿方針の不正確な指示プレビューをプロンプト画面への導線に置換、個別の文字数指定を500文字以内で優先。Deploy #13成功 https://github.com/hasehasehaseha/Threads-Automation/actions/runs/40104174027 。38テストと配信前検査通過。
証跡 C:/Users/ayato/Documents/Codex/Threads-Automation-prompt-library.png と Threads-Automation-prompt-test-success.png 。本番タブ24はログイン済み。仕上げ配信後に不要な再読込で再ログインを要求しない。
Make編集画面では古い未保存OpenAI設定の回復案内が出たが閉じ、現在の保存済みシナリオで実行成功。古い設定をRecover/保存しない。
制約: テストは即時生成ではなく15分poll（今回は検証のためRun once）、履歴は直近30生成ジョブ。翌日分の依頼は既存一意性のため日付ごとの再生成なし。既存10/25ジョブは以前の指示のまま。テストで比較できる。通常生成での新しい3種指示の経路はNode/SQLで検証、実GPTはtestモードで確認。

## 2026-10-24 トークン自動更新（最新）
ユーザーが自動更新を依頼し、暗号化したThreadsトークンをSupabaseへ保存・復号鍵をCloudflare Secretへ保存して有効化することを明示承認済み。
1039b66 / Deploy #11成功: https://github.com/hasehasehaseha/Threads-Automation/actions/runs/40102396812 。SQL005適用済み。Cloudflare THREADS_TOKEN_ENCRYPTION_KEY保存済み（値はどこにも記載しない）。TOKEN_AUTO_REFRESH_ENABLED=trueをwranglerで管理。
src/threads-token.js: AES-256-GCM、サーバーだけが復号。threads_credentialsはanon/authenticatedのテーブル読み取り不可、RPCもservice_roleのみ。leaseで更新の重複を防ぎ、失敗時は旧暗号文保持。publicTokenStatusのallowlist以外はブラウザーへ返さない。期限切れ・再接続状態では投稿claim前に停止し、保存済みトークンがある場合は旧Cloudflare Secretへfallbackしない。
毎日21:30 JSTの既存Cronで更新対象を確認→共通トークンを読み出し→反響取得。成功から7日後に更新対象、失敗から25時間後に再確認対象（実際の実行はその後の21:30）。予約毎分・即時公開・反響は同じ暗号化保存トークンを使用。Make旧配信はInactiveのまま、旧接続トークンの同期は不要・未実装。
2026-10-24 23:27:02 JSTに初回実更新・暗号化保存成功。DB healthy、last_error null、encryption_version 1。expires_at=2026-12-22T22:41:22.367Z（JST12/23 07:41）、next_attempt_at=2026-10-31T14:27:02.430113Z（JST10/31 23:27）。次の自動更新予定は11/01 21:30 JST。初回は管理者ボタンで実行。将来の定期更新実行は未到来。
同じボタンを再実行→not_dueで更新日時が変わらないこと、更新後の保存トークンによる反響取得1件成功・失敗0件を確認。DB実機で権限・二重claim拒否・失敗時旧値保持もrollbackテスト成功。34件のNodeテスト通過。
証跡 C:/Users/ayato/Documents/Codex/Threads-Automation-token-refresh-success.png 。再ログイン済み本番タブ24。
次の保守は認証セッション更新、公開結果照合・復旧UI、期限切れ等からの再認証UI。暗号化鍵の削除・上書きは再暗号化なしに行わない。古い「トークン自動更新未実装」という記述はこの追記で解消。

## 2026-10-24 予約時刻の修正（最新追記）
ユーザーが18:05に予約したが公開されなかったと報告。Makeは08/12/20のみ起動する一方UIは任意時刻を許可していた。ユーザーは「自由な時刻に予約したい」を選択。
42147b6でCloudflare毎分Cronに予約公開を移行。MakeはAI生成に引き続き使用。claim_due_postとpublishClaimを再利用し、原子的claim・15分超過停止・不明時の再投稿禁止を維持。src/scheduler.js追加。反響Cronは21:30のまま分離。
23テスト通過。Deploy #9 https://github.com/hasehasehaseha/Threads-Automation/actions/runs/40100329409 成功。本番に自由時刻表示・Cron追加を確認、Make旧配信10021080はInactive。ユーザー再ログイン済み。
18:05の投稿453ad4cf-0344-4fd1-ab62-355d5c265863は20時のMake claimでneeds_reviewへ移行、Meta IDなし、last_error「予約時刻から15分以上経過しています」。Threadsプロフィール上でも未公開を確認。同じ本文の新規予約テスト794a159e-61bd-4000-ba3d-5d1bf64a56de（23:03 JST）は23:04:55にclaim→needs_review、Threadsに該当本文なし。停止段階が当時未記録のため原因は未断定。再投稿せず保持。
6440f34で準備状態を最大5回・2秒間隔で確認し、コンテナIDをaudit_logへ保存、停止段階と安全な数値APIコードをlast_errorへ保存する改善を追加。外部公開要求を再試行しない設計は維持。25テスト通過、Deploy #10成功: https://github.com/hasehasehaseha/Threads-Automation/actions/runs/40101123005
改善後の実予約テストは成功。DB caaaee45-8090-4176-94b9-d266757f3064「教室のお知らせ（予約投稿の確認）」、23:10 JST予約→23:10:48.347 claim→23:10:57.047公開済み。Meta ID18140719726725229、last_error null。Threadsの本文・URLまで照合: https://www.threads.com/@neis_hiroshima/post/De4UPGAlfiK 。即時投稿・手動claimは使わず実Cronで確認。証跡 C:/Users/ayato/Documents/Codex/Threads-Automation-scheduled-public-success.png と Threads-Automation-scheduled-dashboard-success.png。
既存の21:30 JST反響Cronは実行成功をDBで確認。captured_at=2026-10-24T12:30:27.586764Z、views=11、likes=1。従来「Cron未検証」の記述は解消。
以下の旧「Makeの実公開検証」「予約が3枠のみ」「準備状態1回のみ」「21:30Cron未検証」の記述は、この追記で更新済み。次の主な保守はThreadsトークン更新・認証セッション更新・照合復旧UI。

## 最初に読むもの
この文書 → SETUP.md（運用）→ MAKE.md（外部シナリオ）。実装変更前に対象コードと現在のUIを確認する。ここに記載した外部サービスの状態は検証時点のもの。ブラウザーの要素番号やログイン状態を引き継げると仮定しない。

## ユーザーの目的と進め方
- ネイス体操教室 広島段原ショッピングセンター校の集客用Threads運用。ユーザーは非エンジニア。日本語で具体的に説明する。
- アカウント @neis_hiroshima。1日3投稿、08:00・12:00・20:00、日本時間。
- AI投稿方針・キーワードの調整、スタッフ共有、下書き確認・承認、予約・即時公開、反響分析。
- 低コスト希望。ただしMakeクレジットは利用可。プラン購入の許可ではない。
- 実装・配信・実際の公開テストは明示的に依頼済み。既存の承認を重ねて聞かない。実施済み公開を再実行しない。
- 今回は引き継ぎ準備のみ。モデル変更後に残作業を続ける。

## リソース
- ローカル: C:/Users/ayato/Documents/Codex/Threads-Automation
- GitHub: https://github.com/hasehasehaseha/Threads-Automation （main）
- 本番: https://danbara-threads-studio.hasegawaayato.workers.dev/
- 旧試作品: https://danbara-threads-studio-20261022.aquaperch8.chatgpt.site/ （本番ではない）
- Cloudflare account: 747302b9f123c705d3cd7a1197572d71 / Worker: danbara-threads-studio
- Supabase: wfbbolgkfrydwgzxrzdi / https://wfbbolgkfrydwgzxrzdi.supabase.co
- 管理者: hasegawa@ka-ku-do.com（パスワードはユーザーのみ管理）
- Metaアプリ: Danbara Studio / 1805350007445610。Threads app ID: 1421861320096849。
- Threads user ID: 40462225730042818
- Make eu2 / org1668996 / team556148
- 配信: https://eu2.make.com/556148/scenarios/10021080/edit
- AI: https://eu2.make.com/556148/scenarios/10028014/edit
- 教室の公式情報: https://neis-gym.com/class/hiroshima/neis_1195/

## 検証済みの到達点
- 最新リモートコミット（引き継ぎ作成直前）efe7cec。作業ツリーはclean。
- 本番コード5804d68、Deploy #8成功: https://github.com/hasehasehaseha/Threads-Automation/actions/runs/40079276595
- 20件の自動テスト通過。Supabaseログイン・共有保存、AIの3案保存、即時投稿、反響取得を実動作確認。
- 2026-10-24 17:49 JSTに挨拶投稿を実際に公開済み:
  https://www.threads.com/@neis_hiroshima/post/De3vgIDE7po
- 本文:「ネイス体操教室 広島段原ショッピングセンター校です。これから教室のお知らせをThreadsでお届けします。よろしくお願いします！」＋教室URL。
- DB投稿ID bfa1e1a0-7c13-47b7-a973-fee639232e37。管理画面で公開済み、Threads上の本文を確認。重複公開しない。
- 17:52 JSTの反響取得1件成功・失敗0件。閲覧0、いいね1、返信・再投稿・引用・シェア0。取得時点の値であり現在値ではない。
- 証跡: C:/Users/ayato/Documents/Codex/Threads-Automation-public-test-success.png
- 証跡: C:/Users/ayato/Documents/Codex/Threads-Automation-insights-success.png
- Make配信はActive、08/12/20 Asia/Tokyo。承認済み投稿がない実行は正常終了し公開モジュールへ進まないことを確認。Makeによる実公開自体は未検証。
- AIシナリオはActive、15分間隔。実際にOpenAI経由で翌日分3案保存成功。自動で毎日生成する仕様ではなく、管理画面の依頼ボタンが起点。

## 構成とコードの責務
- GitHub Actionsのworkflow_dispatchで検査・配信。pushだけではデプロイされない。
- public/app.js / index.html: 管理画面。認証トークンはメモリのみ、再読込・期限切れで再ログインが必要。自動更新未実装。
- src/worker.js: Supabaseユーザー・members権限確認、投稿・承認・生成依頼・即時公開・反響・Make向けAPI。
- src/publish.js: Threadsコンテナ作成→状態確認→公開→DB結果報告。自動再試行なし。不明時needs_review。
- src/generation.js: 投稿方針スナップショット、生成結果の検証。
- src/metrics.js: 最新15件の公開済み投稿から累計6指標取得。1時間内取得済みはスキップ。未取得を0にしない。毎日21:30 JSTと手動ボタン。
- supabase/001〜004適用済み。001を既存DBへ再実行しない。RLS、原子的claimとversion競合検出、監査記録あり。
- 配信APIのMAKE_API_TOKENと生成APIのMAKE_AI_TOKENは用途分離。service_roleはブラウザーやMakeへ渡さない。

## Makeの実際のフロー
配信10021080:
- HTTP claim → post.idありフィルター → Threadsコンテナ作成 → threads_publish → result報告。
- 作成/公開失敗はneeds_review報告して停止。結果保存失敗も停止。Rollbackでは公開自体は取り消せない。
- sequential有効、dlq無効、公開自動リトライなし。Makeにはコンテナ準備完了ポーリングがない。
- 接続14689716 Danbara Dashboard Automation、14688750 Danbara Threads - neis_hiroshima。

AI10028014:
- HTTP /api/generation/claim → job.idあり → OpenAI Responses → /api/generation/result。
- OpenAI接続14691360 Danbara OpenAI、gpt-4.1-mini、max_output_tokens2200、store false、createConversation false。
- 結果JSONのoutputは {{escapeJSON(2.result)}} を使用。toJSONはMakeで無効だったため修正済み。
- 既存のローカルAI blueprintは修正前の可能性がある。再インポートせず実際のシナリオを正とする。
- 15分ポーリングは空でも1日96回の確認コスト。無料枠内で月間運用できると断言しない。

## 秘密情報と承認
Cloudflare Secret: SUPABASE_ANON_KEY、SUPABASE_SERVICE_ROLE_KEY、MAKE_API_TOKEN、MAKE_AI_TOKEN、THREADS_ACCESS_TOKEN。
GitHub Actions Secret: CLOUDFLARE_API_TOKEN（限定権限）。Makeには用途別認証接続とOpenAI接続。
これらの作成・各保存先への登録、Meta basic/publish/insights権限、教室アカウントのテスター追加、公開テストは承認済み。
権限拡大や新しい保存先が必要なら適用されるツール規則に従う。広範なCloudflare標準トークンはユーザーが拒否し、限定権限を選択した。
秘密キーをチャット・ログ・ファイル・Gitへ出さない。パスワード入力はユーザーに引き継ぐ。

## 修正済みの重要不具合
Cloudflare Workersのfetchはredirect:'error'非対応でMetaへの送信前に失敗していた。5804d68でpublish/metrics双方をredirect:'manual'へ変更し、非2xxを拒否。トークンを別URLへ転送しない。
この修正後、即時公開と反響取得の実テスト成功。元に戻さない。
以前失敗した投稿9b0ca803-103f-4ca4-8384-1f0da905360e「段原で体操を始めるなら」はneeds_reviewで残っている。自動で再投稿しない。復旧時はMeta ID・監査・Threads公開結果を照合して判断。
「接続確認（投稿しない）」というテスト下書きは公開しない。

## 次の作業の優先順位
1. Makeの定時公開経路を実投稿で検証。現在のシナリオ・トークン・予約状況を確認し、明示的なテスト対象1件だけでclaim→公開→結果保存を確認する。即時公開の成功をMakeの成功と取り違えない。
2. 毎日21:30 JSTの反響Cron実行結果を確認（手動取得は成功済み）。
3. Threadsトークンの期限管理・自動更新を設計実装。現状は手動更新。MakeとCloudflareで同じ時点のトークンとは限らない。
4. 認証セッション更新、要確認の安全な照合・復旧UI、スタッフ招待の順に改善候補。現行未実装を完成済みと説明しない。

その他の制約: 任意の予約時刻を編集できるがMake起動は08/12/20のみ。15分超過はneeds_review。即時投稿はコンテナ状態を1回だけ確認しFINISHED以外で停止するため改善余地あり。反響は最新15件のみ、過去の外部投稿取り込みなし。AIは事実を誤ることがあるので承認前に校舎情報と本文を確認する。

## 作業再開の手順
1. git status/log、SETUP.md、MAKE.mdと関連実装を読む。ユーザーの追加指示を優先する。
2. ブラウザー操作時はcomputer-useスキルと現在のCUAドキュメントに従い、タブと状態を取得する。旧要素IDを使わない。UIから隠しAPIを呼ばない。
3. ログインが有効ならそのまま進む。再読込はログアウトを引き起こすため不要に行わない。認証情報をチャットで求めない。
4. 実公開したか不明なエラーでは再送しない。ThreadsとDBの結果を先に照合する。
5. 変更に応じてnpm test、必要な配信前検査→Actions手動起動→本番確認。ドキュメントのみならテストや配信不要。
6. 新しい検証結果と残作業をこの文書に更新し、ユーザーへ成功と未検証を分けて伝える。

この資料は品質維持のための根拠であり、同一品質を保証するものではない。実際のコード・UI・テスト結果を確認して続行する。

## 2026-10-25 07:54 JST: 翌日3案の定期生成を実証
- 10/26 production job `aff1e88b-6df1-48f7-86e2-021c25e429db` was requested at 07:48:33 JST. It was queued normally, not stuck.
- Make scheduled run at 07:53:47 JST succeeded in 5 seconds, 3 operations / 3 credits: https://eu2.make.com/556148/scenarios/10028014/logs/8dc9dabbba514ed4831280c09a7e6d99
- Production dashboard latest-information refresh showed completed and exactly three new unapproved drafts at 10/26 08:00, 12:00, 20:00 (共感 / 習い事選び / 教室紹介). No manual Make run, duplicate request, code changes or publishing performed.
- Production generation status does not automatically refresh; users must click 最新情報に更新. Make checks every 15 minutes, so queued up to 15 minutes is expected.
- Proof: C:/Users/ayato/Documents/Codex/Threads-Automation-generation-20261026-success.png

## 2026-10-25: 指定日で3案生成を追加
- Code commit 8a56832777fb35eed88a67a0604a64c5cdb23fb5; deploy #14 https://github.com/hasehasehaseha/Threads-Automation/actions/runs/40140774350 (verify outcome).
- supabase/007_generation_date.sql applied successfully. request_generation_for_date(p_actor,p_target) accepts tomorrow or later JST, snapshots target date/settings/3 templates, preserves unique target_date; existing request_generation_job(uuid) delegates tomorrow to this function. No Make configuration changes.
- POST /api/generate accepts optional target_date YYYY-MM-DD; server rejects impossible/current/past dates. No date means original tomorrow behavior. Only service_role can execute RPC, existing active-member checks retained.
- UI keeps tomorrow button and adds date picker/指定日の3案を生成. All results remain draft/unapproved at 08:00,12:00,20:00 JST on selected day. Poll interval remains 15 minutes, manual 最新情報に更新.
- 40 Node tests passed, public/app.js syntax passed. test/generation-date-invariants.sql passed against live DB with rollback: specified date/three unapproved drafts/duplicate callback/request deduplication/past-day rejection/public RPC isolation. No test rows left behind.
- Next: verify deploy #14 success, reload app (memory-only token needs user sign-in), UI test 2026-10-30 generate request and resulting 3 drafts. Do not publish/approve these drafts automatically.
- Deploy #14 SUCCESS (19s) confirmed in GitHub UI. Production tab24 reloaded; awaiting user sign-in for UI-only verification. Original Oct26 generation already completed normally in Make schedule07:53. Screenshot of new date picker still pending login.
- Final live UI verification completed after user sign-in: picked 2026-10-30 in production date input, requested twice before completion and once after completion; same single date job, no duplicates. Ran existing saved Make AI scenario manually once at08:00 JST (no scenario edits; dismissed old Recover modal with Close). Scenario completed, dashboard showed exactly three Oct30 drafts at08:00/12:00/20:00, unapproved. Not published. Screenshot C:/Users/ayato/Documents/Codex/Threads-Automation-date-generation-success.png. Tab24 deliverable; temporary40/41/42 closed. No remaining work for date feature.

## 2026-10-25: 小規模なスマホ表示改善
- User screenshot showed oversized/cropped iPhone view. CSS-only commit655237f6411ac7d91dccfd95172e955c71654b94 adds phone breakpoint <=600px. Keeps same functions and desktop layout.
- Compact logo/nav (4 equal columns),52px header,12px outer gutters,14px body/16px card headings,smaller cards/buttons/status toast; wrap long text, constrain date/datetime inputs. Form text stays16px to reduce iOS focus autozoom; text-size-adjust100%, no disabled user zoom.
- Local fixture under ignored .wrangler/mobile-preview from DOM only (scripts removed) was attempted via4174, but IAB cannot connect to localhost. Local server session2444 must be stopped. No credentials copied.
- Browser viewport capability is available: browser.capabilities.get('viewport').documentation(), set({width:390,height:844}), reset(). Temporary override reset after failed local test. Need verify live phone layout following deployment and user sign-in.
- Deploy #15 SUCCESS: https://github.com/hasehasehaseha/Threads-Automation/actions/runs/40141608792 (job121014342038). Includes CI40tests. Production reloaded; user sign-in requested for final authenticated screenshot. 390x844 login screenshot verified compact readable layout. Browser viewport temporarily390x844, must reset before finishing. Local server2444 stopped withCtrl-C.

## 2026-10-25: 可変1〜7件・個別時刻・個別プロンプト（進行中）
- User explicitly approved1〜7 items, each a JST time+prompt; today future times, tomorrow and arbitrary dates. Keep prompt tests3variants, seed7prompttypes and numbered tabs. Code b8073b447b041419481f831466379ec41954b4ea.
- Applied008_flexible_generation.sql successfully. prompt_plan now slots1〜7 and times text[]; new save_generation_plan(admin/version), generation_snapshot validates active templates/times, request_configured_generation snapshots count/times/templates/targetdate. Old tomorrow/date RPC wrappers still work using saved defaults. Existing unique target_date preserved; existing day's request is returned unchanged. Today queued jobs allowed until selected first time passes. Late jobs become needs_review. Complete SQL exact expectedcount, maps result order to snapshottedtimes, tests remain3, duplicate callback safe. Approve/immediate daily max7 (SQL existing access/grants retained).
-43Node tests PASS, syntax/diff checks PASS. test/flexible-generation-invariants.sql liveDB rollback PASS:1/3/5/7 output counts, immutable snapshots, unique request, exact dates/times, today claim, savedplan5,7approvals/8threjected, service-role-only. No fixture rows retained.
- public/generation-settings.js owns count/row controls, default-save version/dirty protection, today/tomorrow/date actions, actual job history and15sec production polling. public/prompts.js removes oldfixed3plan UI, adds numbered library tabs; existing4templates unchanged and3new factual-safe templates added by008. Token/session handling unchanged.
- Make10028014 OpenAI module Max Output Tokens changed2200→12000 and module +scenario Save clicked. OldRecover modal dismissedClose, did not Recover. No auth/model/mapping changes. Verify persistedvalue after reopening before live5draft test.
- Temporary tabs46SupabaseSQL,47Make,48GitHubdeploy. App24 remains user deliverable. Need deploy success, reload app/user login, UI default-save and5slot date actualgeneration,7tabs and390px overflow check. Do not approve/publish generated test drafts.
- Deploy #17 SUCCESS: https://github.com/hasehasehaseha/Threads-Automation/actions/runs/40142981166 (job121018412476),43tests and package check. App24 refreshed; awaiting in-app user sign-in for UI/live5draft verification. Current Make47 reopened saved scenario for max-output verification. Do not rerun008 seed migration.
- Final UI verification after sign-in SUCCESS: selected5items, times09:15/11:30/14:45/17:00/20:15, prompts3/1/5/6/7. Saved defaults5 successfully, requested2026-10-31, manually ran existing Make scenario08:32 JST. Scenario completed and UI automatically showed completed with exactly5unapproved drafts at correcttimes/topics. Repeatedsame date/config returned same completed5; no duplicates/no approval or publish by agent. Saved defaults back to original3slots08/12/20 and prompts共感/学び/紹介 after test; immutable Oct31job still5.
- Make max_output_tokens12000 persistence verified after full scenario reload; modelgpt-4.1-mini unchanged. Scenario Active every15minutes. 7prompt tabs verified inUI, selecting7loadedcorrecteditor. Current prompteditor has7selected with no edits. Today/future validation and actualtodayclaim verified inrolledbackDB test; currentdayexistingjob is retained by one-job-per-day rule.
- Browser size override requested390 but live screenshot/evaluated document width599, so do not claim exact390UI validation. No horizontal overflow at observed599 (clientWidth=scrollWidth), rows/7tabs fit. CSS<=600breakpoint implemented; priorphonecompact CSS preserved. Viewport must reset before final (done after proof), app24keepdeliverable, close46/47/48.
- Screenshots C:/Users/ayato/Documents/Codex/Threads-Automation-flexible-generation-settings.png and Threads-Automation-seven-prompt-tabs.png; completed-history image also saved separately. Existing old8:00draft appearedalready published at08:30 before verification (not published by this work).
- Updated older SQL regression fixtures for new today/flexible default semantics. No work remains for requested feature.

## 2026-10-25: 生成ボタン付近の件数選択（進行中）
- User screenshot of today/tomorrow/date buttons3件 requested variable count in that area. Added visible 今回生成する件数1〜7 immediately above buttons, grouped with date control, synchronized with existing generation-count and row count/button labels. All three actions still use same slots. Code07ae0d0fa740ca7712c1fb885b211dc785bfb9c8. No DB/Make changes.
- Syntax/diff checks passed. Deployment pending; UI verify top/bottom selectors both directions and labels3→5→7; do not enqueue extra job merely to verify this UI change. Preserve saved defaults3.
- Deploy #18 SUCCESS https://github.com/hasehasehaseha/Threads-Automation/actions/runs/40143605306 (job121020249240),43CItests and dryrun. App24 reloaded, user login requested, keep tab49 for deployment evidence until UI done. Need final3/5/7 selector sync verification and screenshot, no API generation needed.
- Final live UI verification SUCCESS after user sign-in: lower selector5→top5/5rows/all3buttons5, upper7→lower7/7rows/allbuttons7, lower5 again. No job requested and saved defaults unchanged3; current UI unsaved5 for demonstration. Proof C:/Users/ayato/Documents/Codex/Threads-Automation-count-beside-buttons.png. Tab24 kept;49closed. Work complete.

## 2026-10-25: 可変件数の通常投稿プレビューとプロンプト整理（進行中）
- User saw3件 multiple times in editor preview. Root: editor button used test-only validateTest snapshot3; user previously requested tests remain3. Code09bc51437095f459f8f0afcf5edd27b82bcf29c0 separates production vs test preview.
- generationPrompt rewritten with role/request, savedpolicy, numbered per-slot prompt+JSTtime, writing quality, fact rules, output sections. Dynamic count only; instructions explicitly prioritize currentrequest count/order/format over stale individual count instructions. Ban inventedreputation too. JSON contract posts/topic/body unchanged. Same builder used Make claim and both previews.
- POST /prompts/production-preview member-only, accepts current UI target_date/slots, loads latest savedsettings and pure existing generation_snapshot RPC to get authoritative savedtemplates/count/times. Does NOT createjob or callOpenAI. Current unsaved template is intentionally not part of production; editor note and returned title explain. Existing /prompts/preview remains unsaved-editor test3.
- public/generation-settings exposes previewRequest; app passes it into promptStudio. Buttons explicitly 通常投稿用の指示全文を確認 and テスト用の指示全文を確認（3案）. Production preview reflects current unsaved generation count/times/selections; saving individual prompt first needed to affect production. No DB/Make/model/token changes.
-45Node tests pass incl1/5/7 nofixed3, orderedtimeprompt mapping, purepreview nojobs and authoritativeDBinstructions. Browser scripts syntax/diff pass. Need deploy and UI5/7production vs3test preview check after userlogin, proof screenshot. No actualgeneration/publishing needed for this issue.
- Applied OpenAI Docs skill, read official https://developers.openai.com/api/docs/guides/prompt-engineering (sections logical boundaries/formatting) for prompt organization; no model migration. Browserdeploytab50/app24.
- Deploy #19 SUCCESS: https://github.com/hasehasehaseha/Threads-Automation/actions/runs/40144041159 (job121021509345),45tests. App24reloaded/login requested. Need UIcurrentcount5/7 productionpreview andseparatetest3, screenshot, no actualjobcreation required.
- Final live UI PASS after user sign-in: set currentcount5, productionpreview header/body/JSON all5, /3件|3案/ false, lasttemplate5 andtimes present. Set7→preview header/body/JSON all7, nofixed3. Selected firsttemplate→testpreview explicitly3variants/publication-free. Returned count5 and productionpreview5 for deliverable. No job requested, no AI generation, no publish, no saveddefault/prompt edits. Proof C:/Users/ayato/Documents/Codex/Threads-Automation-production-prompt-five.png. App24keep, deploy50closed. Feature complete.

## 2026-10-25: 即時1件テストとボタン直下の結果（進行中）
- User explicitly requests no15min test wait, output on sameprompteditor immediately, one sample instead of3. Implemented code4a6cfab (+pendinglogoutguard): new src/instant-preview.js calls existingmodelgpt-4.1-mini via OpenAI Responses directly fromCF, storefalse/json_object/max1800/45s timeout/no automatic retries. Requires NEW CFSecret OPENAI_API_KEY; no key in code/chat/files. MAKE remains production generation only.
- Supabase009_immediate_single_test.sql APPLIED successfully: new begin_immediate_prompt_test(actor,snapshot,id,claim) atomically starts generating (notqueued) with1count/deliverydirect; UUIDrequestid replay returnscachedjob+oldclaim so serverdoesnotcallOpenAIagain.1simultaneous/user10perhour,2minstaledirect handling. Complete supports snapshotcount1 while old3testjobs stillwork; test_error safe column added. Same service_role-only/RLS controls. DBrollback test/instant-preview-invariants.sql PASS:1preview, requestreplaycache, Makecannotclaimdirectjob, norealposts, accesschecks. Do not rerun009.
- /api/prompts/test now awaits directtest, ctx.waitUntil protectsongoingwork; returns publicTestResult allowlist (noclaims/private settings/APIkey). OnAIerror safejoberror, onhistorysavefailure stillreturns generatedtext withoutretry. /api/state exposes testEnabled bool, test_error history. validateTest adds count1/deliverydirect; builderlegacytestfallback3 maintained. /prompts/preview nownew1test; productionpreview1-7 unchanged.
- UI public/prompts.js displays currentresult immediately belowbuttons in #current-test-result (aria-live/busy), onebody; thenrefresheshistory. Inputediting tested usesunsaved snapshot. Errors/loadinginline; button/tabsdisabledduringtest. Historyremains below. Newtestpreviewlabel1件.51Node tests PASS; syntax/diffPASS. Current code51tests backend, pendingguard onlyUI.
- CFsettings tab51 has AddEnvironmentVariable dialog prefilled KeyOPENAI_API_KEY, Secret checked, Productiononly, ValueEMPTY at preparation. Newrecipient/access confirmation requested viaasync: user may pasteexistingAPIkey inValue and clickAdd1variableanddeploy themselves; awaiting OpenAIキー保存済み. Do NOT inspectCFvalue/screenshot while usermightenterkey; aftersaveconfirm tableonly. OldMakekeycannotbeextracted. Secret save maydeployoldcode, therefore waitforuserCFsaveBEFORE manually deployingnewcodeviaGitHub workflow.
- All implementation necessary is concrete and committed. Need usersecretsave thenworkflowdeploymain, appreload/userlogin, realimmediate1test resulttiming/noMake/noPosts screenshot, docsupdate. Temporarytab52SQLtestresult; app24currentlyloggedinoldcode. OpenAIdocs verified https://developers.openai.com/api/docs/guides/text and /structured-outputs forResponsesJSONmode/output array parsing. No newmodel or subscription.
- User replied 済 to CFkey-entry handoff. CFtable verified OPENAI_API_KEY with Value encrypted, add-dialogclosed, no value viewed/copied. Save was human-performed and authorizes newCFrecipient. New code deployment then dispatchedmain53069b3 (after secret save, to avoid oldcode rollback by CFsettingsdeploy). Pending workflow outcome/UIlogin/live1test. Extra guard ignores oldasync result afterlogout.
- Deploy #20 SUCCESS https://github.com/hasehasehaseha/Threads-Automation/actions/runs/40144953227 (job121024202420),51tests. App24reloaded and userloginrequested. CF51encryptedkeyverified, temp52DBinvariantsPASS,53deploy. Need live1immediatetest no Make, currentpanel+history, postsunchanged, timing and screenshot. No other work remains.
- Final live verification SUCCESS after user sign-in (2026-10-25 09:02 JST): selected 保護者への共感 and entered an unsaved brief about respecting children's wishes when choosing lessons. One click generated exactly one post in the same editor's 今回のテスト結果 panel directly beneath the buttons; matching result saved in history as テスト完了・未公開. Generation completed within the next few browser observations, without a Make execution; exact elapsed time was not measured reliably, so do not claim a precise duration. Posts count remained 19 before/after; no approval, reservation, publication, or saved prompt edit performed. Screenshot: C:/Users/ayato/Documents/Codex/Threads-Automation-instant-single-test-success.png. App24 retained as deliverable; temporary tabs51/52/53 closed. Feature complete. No further deployment needed for this documentation update.
## 2026-10-25：60日履歴参照・Sol/Luna・通常生成$20予算（進行中）
- User accepted Sol default, Luna selectable, last30days full + days31-60 memo, similarity check against60days, one selective retry. Latest steering: tests can also be done in ChatGPT, so do not restrict tests by the production monthly budget. No auto publishing authorized/needed for this feature.
- src/ai-generation.js: direct Responses model gpt-6.1-sol/gpt-6-luna low effort, Standard, max12000 normal/5000 test, storefalse; exact count1-7. Same-response compact memo; hash invalidation on edits; embeddings text-embedding-3-small dimensions256 cached in post_memory, full-history cosine+trigram and intra-batch compare. One retry only affected slots; unresolved similarity saves candidates in job needs_review, no real posts. API or metering failure never automatically repeats a paid call. Test stays1 and inline/history.
- Make remains existing active15min scenario10028014. Existing claim endpoint under flag executes server pipeline, returns job:null => existing data.job.id Exists filter blocks old OpenAI/result modules. Filter visually verified. HTTP1Timeout40→300 set and module+scenario saved; need reopen persistedvalue. No credential or schedule changes. Make54 is temporary tab.
- SQL010 APPLIED (ai_config defaultsol, usage ledger+atomic reservation, post_memory RLSservice-only, history RPC date-60 through date+7 max1500, ai_report). SQL011 APPLIED (atomic global production claim; single production batch at a time). Do not rerun migrations. Test/history-budget-invariants.sql rolledback PASS for010; rerun with011 serial claim assertion in progress in DBtab55.
- UI new AI設定・利用量 tab shows modelpicker admin-only, separate normal/test monthly cost/input/output/unknown reserves/projection. Forecast or actual15 reduces input; actual18 skips retry; atomic20 cap applies ONLYproduction. Estimation charges1.25x standard input conservatively, no cacheddiscount. UTF8bytes+2048 is conservative token bound, not actual token count. UI says Studio recordedcalls only, not provider/account invoice guarantee.
- 60 Node tests passed before final serialRPC change. Need finaltests, DB011invariants, commit/push, deploy GitHubworkflow56, live login/test Sol and modelselector, Make live1batch verification no publish, screenshot. Local wranglerdryrun bundled67KB successfully but sandbox log-file warning outsideworkspace; CI dryrun will independently verify. OpenAI official model/reasoning/embedding docs fetched; preserve explicitSol target. No new secret needed.
- COMPLETE: implementation73e8ce3, linear history/feature-cache optimization9e62648, safe report-write guardaa815fd. Deployment #21 and #22 succeeded; final #23 SUCCESS https://github.com/hasehasehaseha/Threads-Automation/actions/runs/40164328413 (job121082151443),61tests+dryrun. SQL010/011 both applied; final rolledback DBinvariants PASS incl serial production claim, atomic budget+replay, no test budget restriction, history dates and service-only/admin access. Do not rerun migrations.
- User logged in after UI reload. Actual Sol test1 completed inline+history, unsaved brief about how a child can ask to rest during a trial; preview visibly contains historical posts. Model chosenSol. Test used3101input/286output plus historical embedding2473input and sample224input. No real posts created by tests.
- Actual Make Run once at14:07 JST SUCCESS: first HTTP only, existing filter blocked oldOpenAI/result modules (filter0,1operation). Target2026-11-01 generated exactly7 unapproved drafts at08/10/12/14/16/18/20 using prompts3/1/2/4/5/6/7. ai_report modelgpt-6.1-sol, history19 included19, retriedfalse, similar[], completed. 48.803s from job creation to completion includes time before manual Make run; do not claim this is pure inference time. Sol usage4271input/1883output, new text embedding1321input. Production conservativecost0.02953392 USD. First7 DOM cards confirmed correct dates/times and draft statuses. Posts19→26; published still3. No publish/approval performed.
- Luna picker save persisted, actual Luna test1 succeeded (3446input/245output, conservative0.00055325 USD + embedding196input0.00000392). Then picker saved backSol, configversion3. No quality winner determined from these smoke tests; currentdefaultSol. Total testcost0.01122361. Overall15032input/2414output,7meteredcalls, unknown0, memorycache26. Usage uses input1.25x premium conservativeestimate, not invoice/discounted actual. Existing pre-feature usage not imported.
- Make HTTP1Timeout300 persisted after full reload; schedule stillActive15min. Current UI generation controls restoredunsaved3 and dateOct26, saveddefaults3 unchanged; Nov1job immutable7 retained. App24 onAI設定・利用量, Sol selected. Proof C:/Users/ayato/Documents/Codex/Threads-Automation-history-ai-budget.png and Threads-Automation-history-seven-drafts.png. Temp54Make/55DB/56GitHub ready to close; app24deliverable. No required work remains.
## 2026-10-25：週間一括生成（進行中）
- User requests current daily1–7slot schedule/prompts repeated7days, sequential daily generation with prior drafts in history; explicitly no49posts in oneGPToutput. Explained currentdaily7isoneGPTresponse7posts. New weeklybutton shares generation-date as start; labelN×7 dynamic. Runsinbackground evenbrowserclosed and dailyprogress shown. No auto approval/publish.
- SQL012 generation_batches stores7job_ids/newjobids and immutable snapshot; atomic request_weekly_generation creates seven dated jobs with one shared settings/template snapshot, reuses any existingtargetdate, requestUUID replay safe. weekly status returns actual perdaycounts/status/new flags. Modified sharedclaim order target_date thencreated_at (weeklyjobs same transaction timestamp), global claimlock remains. weeklypending RPCserviceonly. Migration applied in DB57 in progress; confirm success then rollbacktest test/weekly-generation-invariants.sql.
- src/weekly-generation.js processes maxoneday per existingminutecron onlywhenbatchpending, same runProduction and claimasMake. Worker registersgeneration andpublishing as separate waitUntil promises. APIgenerate-week validatesactive membership/sameorigin/startdate/unique1–7slots/requestUUID. No paid call at enqueue. /state returns latest10batch progress. public/generation-settings adds weeklybutton/help/status, pollingincludesbatchjobs evenifdailyhistory30limit. Existingdayactions and defaultsave unchanged.
- New3Node tests for atomicAPI1/3/7/noOpenAI, boundedminute invocation, publishing failureisolation. All64tests passed before anyfurtherchanges. Need DBrollbackinvariants, commitpushdeploy GitHub58, app24reload/userlogin, liveweekly7×7 no publish (preferNov2–8 sinceNov1already7). Verify serial chronologicaldates/priorhistorygrowing/progress/49drafts+dedupe. ExistingSoldefaultandbudget$20 retained. Do not changeMake schedule/credentials.
- SQL012 APPLIED SUCCESS; final rolledback test/weekly-generation-invariants.sql PASS (7daily immutable snapshots, replay/overlapreuse, serialdateorder, nextdayseespreviousdrafts, service-only access). Commitb64add1 deployed #24 SUCCESS https://github.com/hasehasehaseha/Threads-Automation/actions/runs/40165463566 (job121085483604),64CItests+dryrun. App24reloaded/loginrequested viaasync; keep24. Temp57SQL/58GitHub; don't rerun012. Pending actualweeklybutton1/3/7 label and live49drafts verification; no actualweeklyrequest made yet. Prooflogin C:/Users/ayato/Documents/Codex/Threads-Automation-weekly-login.png. Work is not complete until liveverification or explicit blocker reported.
- User loggedin, actualweeklyrequestNov2–8 with7daily slots at08/10/12/14/16/18/20 andprompts3/1/2/4/5/6/7. Buttonlabels3→21,1→7,7→49 verified. Saveddefaults3 untouched. Runtimefirst2dayscompleted with7drafts each; history26→33 provesprior-daydraft inclusion, no retries yet; thirdgenerating and4daysqueued atlatestcheck. Originalposts26,published3; expected75posts ifall49complete. Do NOT clickrequestagain until complete; pollingautomatic15sec, backendminuteCron automaticallyclaims one day. No Make Runonce used forweeklytest.
- Displayonlyfix515e608 changesweeklyqueuedlabel to順番待ち（毎分確認） instead of generic15min; deployed #25 SUCCESS https://github.com/hasehasehaseha/Threads-Automation/actions/runs/40165687124. Currentloggedin app24 hasolderJS butcompletedprogresslabelsidentical; do not reload/loseauth just forlabel. No backendchangesin25. Screenshotprogress C:/Users/ayato/Documents/Codex/Threads-Automation-weekly-progress.png.
- CUA vars weeklyDbTab57 editor151/Run149; weeklyProofSql SELECT7jobs+usage. ClickRun, afterresultreadfullAXwith emitfalse; JSONlinecellValue containsjobs. Filterparsedfields toavoidhugeoutput. weeklyDeployTab58 final25. Need waitall7complete, verify49draftsdatesprompts/finalhistory68 andnoextraAPIcalls on repeat, restoreUIcount3/dateOct26 withoutsave, proofcomplete, docscommitpush (no redeployfordocs), close57/58, keep24deliverable. Feature notyetcomplete whilebatchrunning.
- COMPLETE: all7daysNov2–8 successfully completed with7posts each (49 new unapproved drafts). Automatic minutecron ran the days chronologically; no manualMake run. Runtimehistory grew26/33/40/47/54/61/68 (strict liveSQLassertion passed). test/weekly-live-verification.sql PASS on actualbatch:49distinctbody drafts, allunapproved, exactdatesand08/10/12/14/16/18/20 times,7normalgenerationresponsecalls, prior-dayhistory, repeatedsameweekreusesall7jobs/new0andnoadditionalAPIusage. Repeatcheck performed inside a rolledback transaction so no duplicatebatchprogress record remains. No publication or approvals. Expected totalposts75 (26baseline+49); no saveddefaults/model changes. UI restoredunsavedcount3/dateOct26; immutableweeklybatch remains7×7.
- Finalcode515e608, deploy#25success https://github.com/hasehasehaseha/Threads-Automation/actions/runs/40165687124 (64CItests+dryrun), SQL012 applied once. Currentapp24 oldloadedJS differs only weeklyqueuedlabel; all completedlabels matchfinalcode; do not refreshneedlessly. Proof C:/Users/ayato/Documents/Codex/Threads-Automation-weekly-complete.png. Temp57/58closed,24deliverable. No required work remains.
