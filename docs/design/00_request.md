# 要求仕様

## 概要

LINEなどのメッセージアプリで、写真を送らずに写真の内容がテキストだけで分かるようにする

## ユースケース(実装順)

- [ ] [uc0001]利用者は写真をテキストに変換し内容を伝えたい、なぜなら相手は写真を受信できないアプリをつかっているからだ

## 制約

- 要件定義と設計はdocs/designで行うこと。ただしユースケース毎にディレクトリを分けること
- 実装・テストはappsで行うこと。アプリケーション毎にディレクトリ分けすること
- iOS/Androidに対応すること
- ReactNativeのTypeScriptで実装すること
  - コーディング規約下記とすること。ただしルールが競合する場合は、上位を優先すること
    - [プライマリ](https://typescript-jp.gitbook.io/deep-dive/styleguide)
    - [セカンダリ](https://fintan-contents.github.io/mobile-app-crib-notes/react-native/santoku/development/implement/style-guide/typescript-style-guide/)
  - ただしファイル命名規則のみ[Angularのスタイルガイド](https://angular.dev/style-guide)を優先すること
- ユースケース毎に実装完了後、必ず動作する状態にすること
  - 完了したユースケースにはチェックを入れること
- 作業履歴はユースケース毎のディレクトリにファイル保存すること
  - ファイル内容はdocs/templates/06-handoff.template.mdをテンプレートとし、ユースケース完了まで同一ファイルを更新し続けること
