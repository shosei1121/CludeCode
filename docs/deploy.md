# デプロイ手順書（GCP）

## 前提条件

- GCPアカウントを作成済み
- ローカル環境でdocker-composeが正常動作していること
- GitHubにコードがpush済みであること

---

## STEP 1：GCPプロジェクト・VM作成

### 1-1. GCPプロジェクトを作成

1. [console.cloud.google.com](https://console.cloud.google.com) にアクセス
2. 「新しいプロジェクト」を作成（例: `freelance-auto-system`）

### 1-2. Compute Engine VMを作成

```
マシンタイプ : e2-micro（Always Free枠）
リージョン   : asia-northeast1（東京）
OS          : Ubuntu 22.04 LTS
ディスク     : 標準永続ディスク 30GB
ファイアウォール: HTTP・HTTPSのトラフィックを許可にチェック
```

### 1-3. 静的IPアドレスを予約

```
VPCネットワーク → IPアドレス → 静的アドレスを予約
  名前: freelance-auto-system-ip
  リージョン: asia-northeast1
  作成したVMに関連付ける
```

> 月額約550円かかります。LINE WebhookのURL固定に必要です。

---

## STEP 2：VM初期設定

### 2-1. SSHで接続

```bash
gcloud compute ssh インスタンス名 --zone asia-northeast1-a
```

または GCPコンソールの「SSH」ボタンから接続。

### 2-2. 必要パッケージをインストール

```bash
sudo apt-get update && sudo apt-get upgrade -y

# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

# docker-compose
sudo apt-get install -y docker-compose-plugin

# Git
sudo apt-get install -y git

# 動作確認
docker --version
docker compose version
git --version
```

### 2-3. ファイアウォール設定

GCPコンソールの「VPCネットワーク → ファイアウォール」で以下を確認・設定：

| ルール名 | プロトコル/ポート | 用途 |
|---------|----------------|------|
| allow-http | tcp:80 | LINE Webhook受信 |
| allow-https | tcp:443 | HTTPS（Let's Encrypt後） |
| allow-ssh | tcp:22 | SSH接続 |

---

## STEP 3：アプリをデプロイ

### 3-1. リポジトリをクローン

```bash
cd /opt
sudo git clone https://github.com/あなたのユーザー名/freelance-auto-system.git
sudo chown -R $USER:$USER /opt/freelance-auto-system
cd /opt/freelance-auto-system
```

### 3-2. 環境変数を設定

```bash
cp .env.example .env
nano .env
# 各APIキーを入力して保存
```

### 3-3. コンテナを起動

```bash
docker compose up --build -d
docker compose ps  # 全コンテナがUpであることを確認
```

### 3-4. LINE DevelopersのWebhook URLを更新

```
https://{静的IPアドレス}/webhook/line
```

> ドメインを取得してHTTPS化する場合は後述のNginx SSL設定を先に行う。

---

## STEP 4：HTTPS設定（任意・推奨）

### 4-1. ドメインを取得してAレコードを設定

```
Aレコード: your-domain.com → GCPの静的IPアドレス
```

### 4-2. Nginxの設定を更新

`nginx/conf.d/default.conf` を編集してドメイン名を追加。

### 4-3. Let's EncryptでSSL証明書を取得

```bash
# certbotをインストール
sudo apt-get install -y certbot python3-certbot-nginx

# 証明書を取得（コンテナを一時停止）
docker compose stop nginx
sudo certbot certonly --standalone -d your-domain.com
docker compose start nginx
```

---

## STEP 5：GitHub Actions 自動デプロイ設定

`.github/workflows/deploy.yml` を作成：

```yaml
name: Deploy to GCP

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.GCP_HOST }}
          username: ${{ secrets.GCP_USER }}
          key: ${{ secrets.GCP_SSH_KEY }}
          script: |
            cd /opt/freelance-auto-system
            git pull origin main
            docker compose up --build -d
            docker compose ps
```

GitHubの `Settings → Secrets` に以下を登録：

| シークレット名 | 値 |
|--------------|-----|
| GCP_HOST | GCPの静的IPアドレス |
| GCP_USER | GCPのSSHユーザー名 |
| GCP_SSH_KEY | SSH秘密鍵の内容 |

---

## 運用コマンド

```bash
# ログを確認
docker compose logs -f

# 特定コンテナのログ
docker compose logs -f claude-runner

# コンテナを再起動
docker compose restart claude-runner

# 全コンテナを停止
docker compose down

# コードを更新してデプロイ
git pull && docker compose up --build -d
```
