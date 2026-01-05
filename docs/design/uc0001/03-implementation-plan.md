# Implementation Plan: 写真のテキスト変換機能

## 1. Architecture

### コンポーネント構成

```
User Device (iOS/Android)
    ↓
React Native App
    ├── Presentation Layer (UI & State)
    ├── Application Layer (UseCases)
    ├── Domain Layer (Business Logic)
    └── Infrastructure Layer (External Services)
            ↓
    OpenAI Vision API (外部サービス)
```

- **ImageToTextScreen** → UI表示・ユーザー操作受付 → useImageConversion Hook
- **useImageConversion Hook** → UseCaseとJotai Atomsの連携 → 各UseCase
- **SelectImageUseCase** → 画像選択ロジック → ImagePickerRepository
- **ConvertImageToTextUseCase** → 画像→テキスト変換 → VisionRepository
- **VisionApiAdapter** → OpenAI Vision API呼び出し → 外部API

### データフロー

```
1. ユーザー操作（ギャラリー/カメラ選択）
    ↓
2. 画像選択（react-native-image-picker）
    ↓
3. バリデーション（サイズ・形式チェック）
    ↓
4. Base64エンコード
    ↓
5. OpenAI Vision API呼び出し（リトライ機構付き）
    ↓
6. レスポンスパース・Description作成
    ↓
7. UI表示・編集可能化
    ↓
8. コピー/共有（OS機能利用）
```

## 2. Tech Choices & Rationale

### React Native

- **選択**: React Native 0.73+ with TypeScript 5.x
- **理由**: iOS/Android両対応、型安全性、豊富なエコシステム
- **代替案**: Flutter (却下: スキルセット), Native開発 (却下: コスト2倍)

### 状態管理: Jotai 2.x

- **理由**: Atomic設計、TypeScript親和性、Clean Architectureとの相性
- **代替案**: Redux Toolkit (却下: オーバーエンジニアリング), Zustand (却下: Atom単位の最適化不足)

### Vision API: OpenAI Vision API

- **理由**: 高精度な日本語説明、自然な文章、レスポンス良好（3-5秒）
- **代替案**: Google Cloud Vision (却下: コスト高), AWS Rekognition (却下: 日本語弱い)

## 3. API Contract

### OpenAI Vision API

```typescript
// Request
POST https://api.openai.com/v1/chat/completions
Headers:
  Authorization: Bearer {API_KEY}
  Content-Type: application/json

Body:
{
  "model": "gpt-4-vision-preview",
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "この画像の内容を日本語で詳しく説明してください。" },
      { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,{BASE64}" } }
    ]
  }],
  "max_tokens": 500
}

// Response Success (200)
{
  "choices": [{
    "message": {
      "content": "画像の説明テキスト..."
    }
  }]
}
```

### エラー体系

- **NETWORK_ERROR**: ネットワーク接続失敗 → 再試行促す
- **API_ERROR**: OpenAI APIエラー → エラー詳細表示
- **INVALID_IMAGE**: 画像形式・サイズ不正 → バリデーションメッセージ
- **SIZE_EXCEEDED**: ファイルサイズ超過 (>10MB) → サイズ制限通知
- **TIMEOUT**: タイムアウト (>30秒) → 再試行促す

## 4. Data Model & Storage

### ローカルストレージ

現時点ではデータの永続化を行わない。

### APIキー管理

```bash
# .env ファイル（Gitignore対象）
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com
```

### データ保持ポリシー

- **画像データ**: 変換処理後、メモリから即座に破棄
- **テキストデータ**: セッション中のみJotai Atomで保持
- **APIキー**: 環境変数から読み込み

## 5. Failure Modes & Reliability

### タイムアウト・リトライ戦略

- **Timeout**: 30秒
- **Retry**: 最大3回
- **Backoff**: 指数バックオフ（1秒 → 2秒 → 4秒）

```typescript
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    return await fetch(url, { timeout: 30000 });
  } catch (error) {
    if (attempt < 2) {
      await delay(Math.pow(2, attempt) * 1000);
    }
  }
}
```

### 依存障害時の劣化モード

- **OpenAI API障害**: エラーメッセージ表示、編集済みテキスト保持
- **ネットワーク障害**: オフライン検知、変換無効化
- **デバイス容量不足**: 適切なエラーメッセージ

## 6. Security Controls

### 入力検証

```typescript
class ImageValidationService {
  validate(imageData: ImageData): Result<void> {
    // ファイルサイズチェック（10MB以下）
    if (imageData.fileSize > 10 * 1024 * 1024) {
      return Result.fail('画像サイズは10MB以下にしてください');
    }

    // 形式チェック
    const validTypes = ['image/jpeg', 'image/png', 'image/heic'];
    if (!validTypes.includes(imageData.type)) {
      return Result.fail('対応していない画像形式です');
    }

    return Result.ok();
  }
}
```

### 暗号・鍵管理

- **APIキー**: react-native-configで環境変数管理
- **通信**: HTTPS強制

### プライバシー保護

- 画像データはアプリ内で永続化しない
- OpenAI APIに送信（利用規約に基づく）

## 7. Observability

### Logs（開発環境）

```typescript
// イベント
- 'image.select.success'
- 'conversion.start'
- 'conversion.success'
- 'conversion.failure'
- 'api.error'
- 'network.error'
```

### Crash Reporting（本番環境）

- Sentry / Firebase Crashlytics
- エラースタックトレース自動収集

## 8. Performance & Capacity

### パフォーマンス目標

- **画像選択**: < 500ms
- **変換処理**:
  - p50: < 5秒
  - p95: < 10秒（要件）
  - p99: < 15秒

### 最適化戦略

- 画像圧縮（必要に応じて）
- Base64エンコード最適化
- React.memo, useCallback活用

## 9. Rollout & Rollback

### 段階リリース

1. **Internal Testing**: 開発チーム内（1週間）
2. **Alpha Release**: TestFlight / Internal Testing（50名、1週間）
3. **Beta Release**: 公開ベータ（100名、2週間）
4. **GA Release**: 一般公開

### Go/No-Go基準

- ✅ 変換成功率 > 95%
- ✅ クラッシュ率 < 1%
- ✅ p95変換時間 < 10秒
- ✅ 重大なバグゼロ

## 10. Test Strategy

### Unit Tests

```typescript
describe('ImageDescription', () => {
  it('should complete conversion', () => {
    const entity = new ImageDescription(id, imageData);
    entity.completeConversion(description);
    expect(entity.isConversionCompleted).toBe(true);
  });
});

describe('ImageData', () => {
  it('should reject oversized image', () => {
    const result = ImageData.create({
      fileSize: 15 * 1024 * 1024 // 15MB
    });
    expect(result.isFailure).toBe(true);
  });
});
```

### E2E Tests

1. **正常系**: 画像選択 → 変換 → 編集 → コピー
2. **異常系**: 大きすぎる画像を選択
3. **境界値**: ネットワークエラー時の挙動

## 11. Implementation Timeline

### Phase 1: 基盤実装（Week 1-2）

- Domain層: Entity, ValueObject, Repository Interface
- Application層: UseCase, Result型

### Phase 2: Infrastructure実装（Week 2-3）

- Adapter実装
- 単体テスト

### Phase 3: Presentation実装（Week 3-4）

- Jotai Atoms, Hook, Component

### Phase 4: 統合・テスト（Week 4-5）

- 統合テスト、E2E、iOS/Android動作確認

### Phase 5: リリース準備（Week 5-6）

- ストア申請、ドキュメント、ベータテスト

## 12. Dependencies & Prerequisites

### 必須ライブラリ

```json
{
  "dependencies": {
    "react-native": "^0.73.0",
    "jotai": "^2.6.0",
    "react-native-image-picker": "^7.0.0",
    "@react-native-clipboard/clipboard": "^1.13.0",
    "react-native-share": "^10.0.0",
    "react-native-config": "^1.5.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@testing-library/react-native": "^12.0.0",
    "jest": "^29.0.0"
  }
}
```

### 権限設定

**iOS (Info.plist)**:
```xml
<key>NSPhotoLibraryUsageDescription</key>
<string>写真を選択して内容を説明します</string>
<key>NSCameraUsageDescription</key>
<string>写真を撮影して内容を説明します</string>
```

**Android (AndroidManifest.xml)**:
```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.INTERNET" />
```
