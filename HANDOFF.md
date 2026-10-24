# モデル切り替え用引き継ぎ

更新: 2026-10-24 JST。GPT-6 astra → GPT-6.1 sol。同じチャットで続行する前提。秘密キー・パスワードはこの文書に含まない。

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
