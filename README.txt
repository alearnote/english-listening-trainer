English Listening Trainer - PC / Smartphone version

【この版でできること】
- Windows PCから利用
- Renderに公開後、iPhone / Androidからブラウザで利用
- OpenAI APIキーはブラウザ側に保存せず、サーバー側の環境変数に保存

==================================================
A. Windows PCだけで試す場合
==================================================

1. Node.jsをインストール
2. .env.example をコピーし、コピー名を .env に変更
3. .env の OPENAI_API_KEY にAPIキーを入力
4. start.bat をダブルクリック
5. http://localhost:3000 を開く

==================================================
B. スマホから使えるように公開する場合
==================================================

【1】GitHubに新しいリポジトリを作る
例: english-listening-trainer

【2】このフォルダ内のファイルをGitHubへアップロードする
重要:
- .env はアップロードしない
- .gitignore が .env を除外する設定になっています
- .env.example はアップロードしてOKです

【3】Renderで Web Service を作る
- GitHubを接続
- english-listening-trainer リポジトリを選択
- Runtime: Node
- Build Command: npm install
- Start Command: npm start

【4】RenderのEnvironment VariablesにAPIキーを設定
Key:
OPENAI_API_KEY

Value:
自分のOpenAI APIキー

【5】Deployする
公開後、
https://xxxx.onrender.com
のようなURLが発行されます。

そのURLをiPhone / AndroidのSafari・Chromeから開けば利用できます。

==================================================
C. iPhoneでホーム画面に置く
==================================================

1. Safariで公開URLを開く
2. 共有ボタンを押す
3. 「ホーム画面に追加」
4. アプリアイコンのように起動できます

==================================================
重要
==================================================

- OpenAI APIキーをGitHubにアップロードしないでください。
- .env は絶対に公開しないでください。
- OpenAI APIの利用料金はChatGPT Plusとは別です。
- 公開URLを他人に教えると、その人もあなたのAPI利用枠を消費できます。
