# myyajuu-ai-test

独立したAIチャット動作確認用の静的Webページです。

## 起動

GitHub Pagesで公開後、`https://hato2170.github.io/myyajuu-ai-test/ai-test.html` を開きます。WebGPU対応のブラウザーで「モデルを読み込む」を押してください。初回はモデル等のダウンロードに約300 MBを目安とする通信が発生します。

## 仕様と注意

- WebLLMと `Qwen2.5-0.5B-Instruct-q4f16_1-MLC` を使用し、推論は対応端末内で実行します。
- 外部AI推論API、APIキー、Firestore、有料AI APIは使用しません。
- WebLLMのライブラリーとモデルデータは公開配布元から取得します。初回利用時はインターネット接続が必要です。
- 会話履歴は当該ブラウザーの `localStorage` に保存されます。
- WebGPU非対応時に外部AIへ切り替える機能はありません。
- iPhone Safariの動作は機種・OS・利用可能メモリに依存します。実機で確認してください。
