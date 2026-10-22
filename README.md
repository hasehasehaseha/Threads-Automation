# Threads Automation

ネイス体操教室 広島段原ショッピングセンター校の投稿管理。
対象: @neis_hiroshima。日本時間で1日3投稿。

## 構成
GitHub / Cloudflare Workers / Supabase Auth + PostgreSQL / Make / Threads API。
共有画面・保存API・初期DBスキーマを実装。Make・Meta・AIはまだ未接続。
本番稼働済みではありません。

## 開発・検証
`npm ci` → `npm test` → `npx wrangler deploy --dry-run`
`npm run dev` で開発。接続手順・未実装機能は [SETUP.md](SETUP.md)。
Supabase初期スキーマは [supabase/001_initial.sql](supabase/001_initial.sql)。

## 配信
Cloudflare Workers Buildsでこのリポジトリのmainを接続。
ルートはリポジトリ直下。デプロイコマンドは `npx wrangler deploy`。
Supabaseの公開キーとサービスロールキーはCloudflare側に登録し、後者はSecretにする。
認証情報はリポジトリにコミットしない。
