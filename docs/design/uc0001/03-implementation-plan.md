# 実装計画書: 写真のテキスト変換機能

**バージョン**: v1.1
**最終更新**: 2026-01-12
**ステータス**: レビュー完了

## 1. Architecture

### システム全体構成

Clean Architecture + DDD（ドメイン駆動設計）を採用し、レイヤー間の依存関係を厳格に管理する。

```
┌─────────────────────────────────────────────────┐
│          Presentation Layer                     │
│  (React Components, Jotai Atoms, Hooks)        │
│  - ImageToTextScreen                            │
│  - useImageConversion Hook                      │
│  - Design System (Theme, Colors, Typography)   │
└──────────────────┬──────────────────────────────┘
                   │ 依存
┌──────────────────▼──────────────────────────────┐
│         Application Layer                       │
│  (UseCases, DTOs)                               │
│  - SelectImageUseCase                           │
│  - ConvertImageToTextUseCase (w/ AbortSignal)  │
│  - Cancel/Edit/Undo/Redo/Reset UseCases        │
└──────────────────┬──────────────────────────────┘
                   │ 依存
┌──────────────────▼──────────────────────────────┐
│           Domain Layer                          │
│  (Entities, ValueObjects, Services)             │
│  - ImageDescription Entity                      │
│  - ValueObjects: ImageData, Description,        │
│    ConversionStatus, EditHistory (max 50)      │
│  - FileSecurityService (Magic Number)          │
└──────────────────┬──────────────────────────────┘
                   │ インターフェース経由で利用
┌──────────────────▼──────────────────────────────┐
│        Infrastructure Layer                     │
│  (Adapters, External Services)                  │
│  - VisionApiAdapter (w/ AbortController)        │
│  - ImagePickerAdapter                           │
│  - ClipboardAdapter, ShareAdapter               │
│  - FileValidator (Magic Number Check)           │
└─────────────────────────────────────────────────┘
```

### コンポーネント間データフロー

```
User Action (画像選択)
    ↓
ImagePicker Component → selectFromGallery()
    ↓
SelectImageUseCase → ImagePickerRepository
    ↓ FileSecurityService (Magic Number Check)
    ↓ ImageValidationService (Size/Format/Resolution)
    ↓
ImageData ValueObject 作成
    ↓
Jotai Atom (imageDescriptionAtom) 更新
    ↓
ImagePreview Component 表示

User Action (変換開始)
    ↓
ActionButtons → convertToText()
    ↓
AbortController 作成 → abortControllerAtom 保存
    ↓
ConvertImageToTextUseCase.execute(imageData, abortSignal)
    ↓
VisionApiAdapter.convertToText() ← AbortSignal渡す
    ↓ [リトライ機構: 1秒→3秒→5秒, max 3回]
    ↓ [タイムアウト: 30秒]
    ↓
Description ValueObject 作成
    ↓
ImageDescription.completeConversion(description)
    ↓ EditHistory 初期化 (Undo/Redo用)
    ↓
Jotai Atom 更新
    ↓
ConversionResult Component 表示 (編集可能)

User Action (編集)
    ↓
EditDescriptionUseCase.execute(imageDescription, newText)
    ↓
ImageDescription.editDescription(newText)
    ↓ EditHistory.push(newDescription)
    ↓
Jotai Atom 更新
    ↓
Undo/Redo ボタン状態更新

User Action (Undo/Redo)
    ↓
Undo/RedoEditUseCase.execute()
    ↓
EditHistory.undo() / redo()
    ↓
現在の Description 取得
    ↓
Jotai Atom 更新

User Action (キャンセル)
    ↓
CancelConversionUseCase.execute(abortController)
    ↓
abortController.abort()
    ↓
VisionApiAdapter で AbortError キャッチ
    ↓
変換処理中断、クリーンアップ
```

### ディレクトリ構成

```
src/
├── domain/                                    # Domain Layer
│   ├── entities/
│   │   └── image-description.entity.ts        # 画像説明エンティティ
│   ├── value-objects/
│   │   ├── image-data.value-object.ts         # 画像データ値オブジェクト
│   │   ├── description.value-object.ts        # 説明テキスト値オブジェクト
│   │   ├── conversion-status.value-object.ts  # 変換ステータス
│   │   └── edit-history.value-object.ts       # 編集履歴（Undo/Redo、max 50）
│   ├── repositories/                          # Repository Interface（抽象）
│   │   ├── image-picker.repository.ts
│   │   ├── vision.repository.ts               # AbortSignal対応
│   │   ├── clipboard.repository.ts
│   │   └── share.repository.ts
│   ├── services/
│   │   ├── image-validation.service.ts        # 画像検証サービス
│   │   └── file-security.service.ts           # マジックナンバー検証
│   └── errors/
│       └── domain.error.ts                    # ドメイン例外定義
│
├── application/                               # Application Layer
│   ├── use-cases/
│   │   ├── select-image.use-case.ts           # 画像選択（セキュリティ検証含む）
│   │   ├── convert-image-to-text.use-case.ts  # 変換（AbortSignal対応）
│   │   ├── cancel-conversion.use-case.ts      # 変換キャンセル
│   │   ├── edit-description.use-case.ts       # 説明編集（履歴記録）
│   │   ├── undo-edit.use-case.ts              # 編集取り消し
│   │   ├── redo-edit.use-case.ts              # 編集やり直し
│   │   ├── reset-description.use-case.ts      # 説明リセット
│   │   ├── copy-text.use-case.ts              # コピー
│   │   └── share-text.use-case.ts             # 共有
│   ├── dto/
│   │   └── image-conversion.dto.ts            # データ転送オブジェクト
│   └── common/
│       └── result.ts                          # Result型実装
│
├── infrastructure/                            # Infrastructure Layer
│   ├── adapters/
│   │   ├── image-picker.adapter.ts            # react-native-image-picker実装
│   │   ├── vision-api.adapter.ts              # OpenAI Vision API（AbortController）
│   │   ├── clipboard.adapter.ts               # Clipboard実装
│   │   └── share.adapter.ts                   # Share実装
│   ├── config/
│   │   └── api.config.ts                      # API設定（環境変数）
│   └── security/
│       └── file-validator.ts                  # マジックナンバーチェック
│
└── presentation/                              # Presentation Layer
    ├── screens/
    │   └── image-to-text.screen.tsx           # メイン画面
    ├── components/
    │   ├── image-picker.component.tsx         # 画像選択UI
    │   ├── image-preview.component.tsx        # 画像プレビュー
    │   ├── conversion-result.component.tsx    # 変換結果表示（編集エリア）
    │   ├── edit-toolbar.component.tsx         # Undo/Redo/Resetツールバー
    │   ├── conversion-progress.component.tsx  # 進行状況（キャンセルボタン）
    │   ├── action-buttons.component.tsx       # アクションボタン群
    │   └── error-message.component.tsx        # エラーメッセージ表示
    ├── state/
    │   └── image-conversion.atoms.ts          # Jotai atoms定義
    ├── hooks/
    │   └── use-image-conversion.hook.ts       # カスタムフック
    ├── theme/
    │   ├── colors.ts                          # カラーパレット（Light/Dark）
    │   ├── typography.ts                      # タイポグラフィ定義
    │   ├── spacing.ts                         # スペーシング定義
    │   ├── animations.ts                      # アニメーション定義
    │   └── use-theme.hook.ts                  # テーマ切り替えフック
    ├── constants/
    │   └── error-messages.ts                  # エラーメッセージマッピング
    └── design/
        └── ui-specifications.md               # UI/UX詳細設計仕様
```

## 2. Tech Choices & Rationale

### 技術スタック選定

#### 開発フレームワーク

| 技術 | バージョン | 選定理由 | 代替案と却下理由 |
|:-----|:---------|:---------|:---------------|
| **React Native** | 0.73+ | iOS/Android両対応、TypeScript完全サポート、豊富なエコシステム | Flutter（却下: チームスキルセット不足）、Native開発（却下: 開発コスト2倍） |
| **TypeScript** | 5.0+ | 型安全性、IDE補完、リファクタリング容易性、Clean Architectureとの相性 | JavaScript（却下: 大規模開発での保守性低下） |

#### 状態管理

| 技術 | バージョン | 選定理由 | 代替案と却下理由 |
|:-----|:---------|:---------|:---------------|
| **Jotai** | 2.6+ | Atomic設計、React Suspense対応、TypeScript親和性高、軽量、ボトムアップな状態設計、Clean Architectureとの相性良好 | Redux Toolkit（却下: ボイラープレート多、小規模アプリには過剰）、Zustand（却下: Atom単位の最適化不足、グローバル状態寄り） |

#### 外部API

| API | 選定理由 | 代替案と却下理由 |
|:---|:---------|:---------------|
| **OpenAI Vision API** (GPT-4 Vision) | 高精度な日本語説明、自然な文章生成、レスポンス良好（3-5秒）、詳細度調整可能 | Google Cloud Vision API（却下: コスト高、レスポンス遅い）、AWS Rekognition（却下: 日本語説明生成に弱い） |

#### ネイティブ機能連携

| ライブラリ | バージョン | 用途 | 選定理由 |
|:---------|:---------|:-----|:---------|
| **react-native-image-picker** | 7.0+ | ギャラリー/カメラ選択 | ネイティブ統合、カスタマイズ可、実績豊富、iOS/Android両対応 |
| **@react-native-clipboard/clipboard** | 1.13+ | クリップボード操作 | シンプルAPI、安定性高、広く使用されている |
| **react-native-share** | 10.0+ | 共有機能 | OSネイティブシェアシート対応、豊富な共有オプション |
| **react-native-dotenv** | 3.4+ | 環境変数管理 | APIキー等の機密情報を安全に管理、.gitignore対象 |

#### HTTP通信

| ライブラリ | 選定理由 |
|:---------|:---------|
| **Fetch API (Native)** | React Native標準、AbortController対応、TypeScript型定義完備、追加依存なし |

### トレードオフ分析

#### 性能 vs 複雑性
- **トレードオフ**: Clean Architecture採用によりレイヤー分離で複雑性は増すが、保守性・テスタビリティを優先
- **決定**: 初期開発コスト増 > 長期保守コスト削減を重視
- **理由**: 機能追加・変更が頻繁に発生する想定、外部API切り替えの可能性

#### 開発速度 vs 保守性
- **トレードオフ**: Clean Architectureにより初期開発は遅くなるが、長期的な保守性向上
- **決定**: 保守性を優先、ユースケース単位での段階的実装で開発速度も確保
- **理由**: 将来的な機能拡張（履歴保存、多言語対応等）を見据えた設計

#### コスト vs 品質
- **トレードオフ**: OpenAI Vision APIはコストやや高いが、日本語説明品質が最優先
- **決定**: ユーザー体験を最優先、コスト監視機構を実装
- **理由**: 要件「優れたUXを提供する」との整合性

## 3. API Contract

### OpenAI Vision API仕様

#### リクエスト仕様

```typescript
// Endpoint
POST https://api.openai.com/v1/chat/completions

// Headers
{
  "Authorization": "Bearer {OPENAI_API_KEY}",
  "Content-Type": "application/json"
}

// Request Body
{
  "model": "gpt-4-vision-preview",
  "messages": [{
    "role": "user",
    "content": [
      {
        "type": "text",
        "text": "この画像の内容を日本語で詳しく説明してください。"
      },
      {
        "type": "image_url",
        "image_url": {
          "url": "data:image/jpeg;base64,{BASE64_ENCODED_IMAGE}"
        }
      }
    ]
  }],
  "max_tokens": 500
}
```

#### レスポンス仕様

```typescript
// Success Response (200 OK)
{
  "choices": [{
    "message": {
      "content": "画像には青空を背景に、満開の桜の木が写っています。桜の花びらは薄いピンク色で、風に揺れている様子が見られます。..."
    }
  }],
  "usage": {
    "prompt_tokens": 1234,
    "completion_tokens": 150,
    "total_tokens": 1384
  }
}

// Error Response (4xx/5xx)
{
  "error": {
    "message": "Rate limit exceeded",
    "type": "rate_limit_error",
    "code": "rate_limit_exceeded"
  }
}
```

### エラーコード体系

| HTTPステータス | エラーコード | 内部コード | ユーザー向けメッセージ | リトライ可否 |
|:-------------|:-----------|:---------|:-------------------|:-----------|
| 400 | INVALID_REQUEST_ERROR | API_ERROR | テキストの生成に失敗しました | No |
| 401 | AUTHENTICATION_ERROR | API_UNAUTHORIZED | APIキーが無効です。アプリを再起動してください | No |
| 429 | RATE_LIMIT_EXCEEDED | API_RATE_LIMIT | 現在、ご利用が集中しています。しばらく待ってから再試行してください | No（手動のみ） |
| 500 | INTERNAL_SERVER_ERROR | API_SERVER_ERROR | サーバーエラーが発生しました。しばらく待ってから再試行してください | Yes |
| 503 | SERVICE_UNAVAILABLE | API_SERVER_ERROR | サーバーエラーが発生しました。しばらく待ってから再試行してください | Yes |
| - | Network Error | API_NETWORK_ERROR | ネットワークエラーが発生しました。インターネット接続を確認してください | Yes |
| - | Timeout (>30s) | API_timeout | 処理がタイムアウトしました。もう一度お試しください | Yes |
| - | AbortError | CONVERSION_CANCELLED | 変換がキャンセルされました | No |

### エラーメッセージマッピング

```typescript
// presentation/constants/error-messages.ts

export const ERROR_MESSAGES = {
  // 画像選択エラー
  IMAGE_PICKER_CANCELLED: '画像の選択がキャンセルされました',
  IMAGE_PICKER_PERMISSION_DENIED: 'カメラまたはギャラリーへのアクセス権限がありません。設定から権限を許可してください。',
  IMAGE_PICKER_UNKNOWN: '画像の選択中にエラーが発生しました',

  // 画像バリデーションエラー
  IMAGE_SIZE_EXCEEDED: '画像サイズは10MB以下にしてください（現在: {size}MB）',
  IMAGE_RESOLUTION_TOO_LOW: '画像の解像度が低すぎます。100x100ピクセル以上の画像を選択してください。',
  IMAGE_FORMAT_UNSUPPORTED: '対応していない画像形式です。JPEG、PNG、HEIC、WebP形式の画像を選択してください。',

  // セキュリティエラー
  FILE_SECURITY_INVALID: 'この形式のファイルは読み込めません',
  FILE_MAGIC_NUMBER_MISMATCH: 'ファイルの内容が不正です',

  // API エラー
  API_NETWORK_ERROR: 'ネットワークエラーが発生しました。インターネット接続を確認してください。',
  API_TIMEOUT: '処理がタイムアウトしました。もう一度お試しください。',
  API_RATE_LIMIT: '現在、ご利用が集中しています。しばらく待ってから再試行してください。',
  API_SERVER_ERROR: 'サーバーエラーが発生しました。しばらく待ってから再試行してください。',
  API_UNAUTHORIZED: 'APIキーが無効です。アプリを再起動してください。',

  // 変換エラー
  CONVERSION_FAILED: 'テキストの生成に失敗しました',
  CONVERSION_CANCELLED: '変換がキャンセルされました',
  CONVERSION_EMPTY_RESULT: 'テキストの生成に失敗しました',

  // 編集エラー
  EDIT_EMPTY_TEXT: '説明を空にすることはできません',
  EDIT_TOO_LONG: '説明が長すぎます（最大10,000文字）',
  EDIT_NO_DESCRIPTION: '変換前に編集することはできません',

  // Undo/Redoエラー
  UNDO_NOT_AVAILABLE: '取り消す操作がありません',
  REDO_NOT_AVAILABLE: 'やり直す操作がありません',
  RESET_NOT_AVAILABLE: 'リセットできる元のテキストがありません',

  // クリップボード/共有エラー
  CLIPBOARD_COPY_FAILED: 'クリップボードへのコピーに失敗しました',
  SHARE_FAILED: '共有に失敗しました',
  SHARE_CANCELLED: '共有がキャンセルされました',

  // 一般エラー
  UNKNOWN_ERROR: '予期しないエラーが発生しました',
} as const;
```

## 4. Data Model & Storage

### ドメインモデル

#### Entity: ImageDescription

```typescript
export class ImageDescription {
  private readonly _id: string;
  private readonly _imageData: ImageData;
  private _description: Description | undefined;
  private _status: ConversionStatus;
  private _editHistory: EditHistory;                    // Undo/Redo用
  private _originalDescription: Description | undefined; // リセット用
  private readonly _createdAt: Date;
  private _updatedAt: Date;

  constructor(
    id: string,
    imageData: ImageData,
    status: ConversionStatus = ConversionStatus.pending()
  ) {
    this._id = id;
    this._imageData = imageData;
    this._status = status;
    this._editHistory = EditHistory.empty();
    this._createdAt = new Date();
    this._updatedAt = new Date();
  }

  // ドメインロジック
  completeConversion(description: Description): void {
    this._description = description;
    this._originalDescription = description;
    this._editHistory = EditHistory.initialize(description);
    this._status = ConversionStatus.completed();
    this._updatedAt = new Date();
  }

  editDescription(newText: string): void {
    if (!this._description) {
      throw new DomainError('Cannot edit description before conversion');
    }
    const newDescription = Description.create(newText, this._description.confidence);
    this._editHistory = this._editHistory.push(newDescription);
    this._description = newDescription;
    this._updatedAt = new Date();
  }

  undoEdit(): void {
    if (!this._editHistory.canUndo()) {
      throw new DomainError('No edit to undo');
    }
    this._editHistory = this._editHistory.undo();
    this._description = this._editHistory.current();
    this._updatedAt = new Date();
  }

  redoEdit(): void {
    if (!this._editHistory.canRedo()) {
      throw new DomainError('No edit to redo');
    }
    this._editHistory = this._editHistory.redo();
    this._description = this._editHistory.current();
    this._updatedAt = new Date();
  }

  resetDescription(): void {
    if (!this._originalDescription) {
      throw new DomainError('No original description to reset to');
    }
    this._description = this._originalDescription;
    this._editHistory = EditHistory.initialize(this._originalDescription);
    this._updatedAt = new Date();
  }

  cancelConversion(): void {
    if (!this._status.isProcessing()) {
      throw new DomainError('Cannot cancel conversion that is not in progress');
    }
    this._status = ConversionStatus.cancelled();
    this._updatedAt = new Date();
  }

  // Getters
  get canUndo(): boolean { return this._editHistory.canUndo(); }
  get canRedo(): boolean { return this._editHistory.canRedo(); }
  get hasBeenEdited(): boolean {
    return this._originalDescription !== undefined &&
           !this._description?.equals(this._originalDescription);
  }
}
```

#### ValueObject: EditHistory

```typescript
export class EditHistory {
  private static readonly MAX_HISTORY_SIZE = 50; // 最大履歴数

  private constructor(
    private readonly _history: Description[],
    private readonly _currentIndex: number
  ) {}

  static empty(): EditHistory {
    return new EditHistory([], -1);
  }

  static initialize(initialDescription: Description): EditHistory {
    return new EditHistory([initialDescription], 0);
  }

  push(description: Description): EditHistory {
    // 現在位置より後ろの履歴を削除（Redoスタッククリア）
    const newHistory = this._history.slice(0, this._currentIndex + 1);
    newHistory.push(description);

    // 最大サイズを超えた場合は古い履歴を削除
    if (newHistory.length > EditHistory.MAX_HISTORY_SIZE) {
      newHistory.shift();
      return new EditHistory(newHistory, newHistory.length - 1);
    }

    return new EditHistory(newHistory, newHistory.length - 1);
  }

  undo(): EditHistory {
    if (!this.canUndo()) {
      throw new Error('Cannot undo: no previous state');
    }
    return new EditHistory(this._history, this._currentIndex - 1);
  }

  redo(): EditHistory {
    if (!this.canRedo()) {
      throw new Error('Cannot redo: no next state');
    }
    return new EditHistory(this._history, this._currentIndex + 1);
  }

  current(): Description {
    return this._history[this._currentIndex];
  }

  canUndo(): boolean {
    return this._currentIndex > 0;
  }

  canRedo(): boolean {
    return this._currentIndex < this._history.length - 1;
  }
}
```

#### ValueObject: ImageData

```typescript
export class ImageData {
  private constructor(
    private readonly _uri: string,
    private readonly _type: ImageType,
    private readonly _fileSize: number,    // バイト単位
    private readonly _width: number,       // ピクセル
    private readonly _height: number       // ピクセル
  ) {}

  static create(params: {
    uri: string;
    type: string;
    fileSize: number;
    width: number;
    height: number;
  }): Result<ImageData> {
    // バリデーション
    if (!params.uri) {
      return Result.fail('URI is required');
    }

    const imageType = ImageType.fromString(params.type);
    if (!imageType) {
      return Result.fail(`Unsupported image type: ${params.type}`);
    }

    // 10MB厳密チェック
    if (params.fileSize > 10485760) {
      return Result.fail('Image size exceeds 10MB limit');
    }

    // 最小解像度チェック
    if (params.width < 100 || params.height < 100) {
      return Result.fail('Image resolution too low (minimum 100x100)');
    }

    return Result.ok(
      new ImageData(
        params.uri,
        imageType,
        params.fileSize,
        params.width,
        params.height
      )
    );
  }

  equals(other: ImageData): boolean {
    return this._uri === other._uri;
  }
}
```

### ストレージ方針

#### セッション内データ（Jotai Atoms）

| データ | 保持期間 | 削除タイミング |
|:------|:--------|:-------------|
| 選択画像データ（URI） | セッション中のみ | 画面遷移時、別の画像選択時 |
| 変換結果テキスト | セッション中のみ | 別の画像選択時 |
| 編集履歴（EditHistory） | セッション中のみ | 別の画像選択時 |
| AbortController | 変換処理中のみ | 変換完了時、キャンセル時 |

#### 機密情報管理

| 項目 | 管理方法 | 具体的実装 |
|:-----|:---------|:---------|
| APIキー | 環境変数（.env） | react-native-dotenvで読み込み、.gitignore対象 |
| APIキーのログ出力 | 禁止 | ログ記録時にマスク処理 |
| 画像データ | 一時メモリのみ | 変換完了後に即座に破棄、永続化しない |

## 5. Failure Modes & Reliability

### タイムアウト・リトライ戦略

#### パラメータ

```typescript
const RETRY_CONFIG = {
  maxRetries: 3,              // 最大リトライ回数
  timeout: 30000,             // タイムアウト時間（30秒）
  retryDelays: [1000, 3000, 5000], // リトライ間隔（指数バックオフ）
};
```

#### リトライフロー

```typescript
async convertToText(imageData: ImageData, abortSignal?: AbortSignal) {
  let lastError: Error;

  for (let attempt = 0; attempt < this.maxRetries; attempt++) {
    try {
      // キャンセルチェック
      if (abortSignal?.aborted) {
        throw new DOMException('Conversion aborted', 'AbortError');
      }

      // タイムアウトとAbortSignalを結合
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), this.timeout);

      const combinedSignal = this.combineAbortSignals(
        abortSignal,
        timeoutController.signal
      );

      const response = await fetch(url, { signal: combinedSignal });

      clearTimeout(timeoutId);

      // レート制限エラーは自動リトライしない
      if (response.status === 429) {
        return Result.fail('API_RATE_LIMIT');
      }

      // 成功時
      return Result.ok(description);

    } catch (error) {
      lastError = error;

      // AbortErrorはリトライせずに即座に失敗
      if (lastError.name === 'AbortError') {
        throw lastError;
      }

      // 最後のリトライでない場合は待機
      if (attempt < this.maxRetries - 1) {
        await this.delay(Math.pow(2, attempt) * 1000);
      }
    }
  }

  return Result.fail('API_ERROR');
}
```

### 依存障害時の劣化モード

| 依存先 | 障害シナリオ | 劣化動作 | ユーザー影響 |
|:------|:-----------|:--------|:-----------|
| OpenAI Vision API | ネットワークエラー | 自動リトライ（最大3回）、失敗時エラーメッセージ表示 | 変換機能一時利用不可、編集済みテキストは保持 |
| OpenAI Vision API | レート制限（429） | 手動リトライのみ、待機時間表示 | 変換機能一時利用不可、待機時間後に再試行可能 |
| OpenAI Vision API | タイムアウト（>30秒） | 自動キャンセル、エラーメッセージ表示 | 変換機能リトライ可能 |
| デバイスカメラ | 権限拒否 | カメラボタン無効化、ギャラリーのみ利用可能 | カメラ撮影不可、ギャラリー選択は可能 |
| デバイスギャラリー | 権限拒否 | ギャラリーボタン無効化、カメラのみ利用可能 | ギャラリー選択不可、カメラ撮影は可能 |
| クリップボード | コピー失敗 | エラーメッセージ表示、リトライ可能 | コピー機能一時利用不可、共有は可能 |

### エラー回復戦略

```typescript
// 変換エラー時の回復フロー
if (conversionResult.isFailure) {
  // 1. エラーをユーザーフレンドリーなメッセージにマッピング
  const userMessage = mapErrorToUserMessage(conversionResult.error);

  // 2. リトライ可能かチェック
  const isRetryable = isRetryableError(conversionResult.error);

  // 3. UIに反映
  setError(userMessage);
  setCanRetry(isRetryable);

  // 4. ログに技術的詳細を記録（ユーザーには非表示）
  console.error('[Conversion Error]', {
    code: conversionResult.error,
    imageSize: imageData.fileSize,
    timestamp: new Date().toISOString(),
  });
}
```

## 6. Security Controls

### 入力検証

#### FileSecurityService（マジックナンバーチェック）

```typescript
export class FileSecurityService {
  private readonly MAGIC_NUMBERS: Record<string, number[]> = {
    'image/jpeg': [0xFF, 0xD8, 0xFF],
    'image/png': [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
    'image/heic': [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70],
    'image/webp': [0x52, 0x49, 0x46, 0x46],
  };

  async validate(imageData: ImageData): Promise<Result<SecurityValidationResult>> {
    // 1. ファイルの先頭12バイトを読み取り
    const headerBytes = await this.readFileHeader(imageData.uri, 12);

    // 2. マジックナンバーで実際の形式を検出
    const detectedFormat = this.detectFormat(headerBytes);

    if (!detectedFormat) {
      return Result.fail({ isValid: false, error: 'Unknown file format' });
    }

    // 3. 宣言された形式と実際の形式が一致するか確認
    const declaredFormat = imageData.type.toString().toUpperCase();
    if (!this.isFormatMatch(declaredFormat, detectedFormat)) {
      // セキュリティエラーはログに記録するが、ユーザーには一般的なメッセージ
      console.error('[Security] File extension mismatch:', {
        declared: declaredFormat,
        detected: detectedFormat,
      });
      return Result.fail({ isValid: false, error: 'File mismatch' });
    }

    return Result.ok({ isValid: true, detectedFormat });
  }

  private detectFormat(bytes: number[]): 'JPEG' | 'PNG' | 'HEIC' | 'WEBP' | undefined {
    // JPEG: FF D8 FF
    if (this.matchesSignature(bytes, this.MAGIC_NUMBERS['image/jpeg'], 0)) {
      return 'JPEG';
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (this.matchesSignature(bytes, this.MAGIC_NUMBERS['image/png'], 0)) {
      return 'PNG';
    }

    // HEIC: ftyp at offset 4
    if (bytes.length >= 12 && this.matchesSignature(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
      return 'HEIC';
    }

    // WebP: RIFF at offset 0, WEBP at offset 8
    if (bytes.length >= 12 &&
        this.matchesSignature(bytes, this.MAGIC_NUMBERS['image/webp'], 0) &&
        this.matchesSignature(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
      return 'WEBP';
    }

    return undefined;
  }
}
```

#### ImageValidationService（サイズ・形式・解像度チェック）

```typescript
export class ImageValidationService {
  validate(imageData: ImageData): Result<void> {
    // 1. ファイルサイズチェック（10MB厳密）
    if (imageData.fileSize > 10485760) {
      const sizeMB = (imageData.fileSize / 1024 / 1024).toFixed(2);
      return Result.fail(formatErrorMessage('IMAGE_SIZE_EXCEEDED', { size: sizeMB }));
    }

    // 2. 形式チェック
    const validTypes = ['image/jpeg', 'image/png', 'image/heic', 'image/webp'];
    if (!validTypes.includes(imageData.type.mimeType)) {
      return Result.fail('IMAGE_FORMAT_UNSUPPORTED');
    }

    // 3. 解像度チェック
    if (imageData.width < 100 || imageData.height < 100) {
      return Result.fail('IMAGE_RESOLUTION_TOO_LOW');
    }

    return Result.ok();
  }
}
```

### 暗号・鍵管理

```bash
# .env ファイル（Git管理外）
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxx
OPENAI_BASE_URL=https://api.openai.com

# .gitignore
.env
.env.local
.env.production
```

```typescript
// infrastructure/config/api.config.ts
import Config from 'react-native-config';

export class ApiConfig {
  static get openaiApiKey(): string {
    const key = Config.OPENAI_API_KEY;
    if (!key) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    return key;
  }

  static get openaiBaseUrl(): string {
    return Config.OPENAI_BASE_URL || 'https://api.openai.com';
  }
}
```

### プライバシー保護

| 項目 | 保護方法 | 実装詳細 |
|:-----|:---------|:--------|
| 画像データ | 永続化しない | セッション中のみメモリ保持、変換完了後に即座に破棄 |
| 生成テキスト | ログに記録しない | デバッグログにもテキスト内容は含めない（文字数のみ記録） |
| API通信 | HTTPS強制 | すべてのAPIリクエストをHTTPS経由、HTTPへのフォールバックなし |
| ユーザー同意 | 初回起動時取得 | 画像データを外部APIに送信することへの明示的な同意 |

## 7. Observability

### ログ記録方針

#### ログレベル定義

```typescript
enum LogLevel {
  ERROR = 'ERROR',   // エラー（本番環境で記録）
  WARN = 'WARN',     // 警告（本番環境で記録）
  INFO = 'INFO',     // 情報（本番環境で記録）
  DEBUG = 'DEBUG',   // デバッグ（開発環境のみ）
}
```

#### ログイベント定義

```typescript
// イベント名規約: [domain].[action].[result]
const LOG_EVENTS = {
  // 画像選択
  'image.select.start': { level: LogLevel.INFO },
  'image.select.success': { level: LogLevel.INFO },
  'image.select.cancelled': { level: LogLevel.INFO },
  'image.select.error': { level: LogLevel.ERROR },

  // 画像バリデーション
  'validation.size.exceeded': { level: LogLevel.WARN },
  'validation.format.unsupported': { level: LogLevel.WARN },
  'validation.resolution.too_low': { level: LogLevel.WARN },

  // セキュリティ
  'security.file.invalid': { level: LogLevel.ERROR },
  'security.magic_number.mismatch': { level: LogLevel.ERROR },

  // 変換処理
  'conversion.start': { level: LogLevel.INFO },
  'conversion.success': { level: LogLevel.INFO },
  'conversion.cancelled': { level: LogLevel.INFO },
  'conversion.error': { level: LogLevel.ERROR },

  // API呼び出し
  'api.request.start': { level: LogLevel.DEBUG },
  'api.request.success': { level: LogLevel.INFO },
  'api.request.retry': { level: LogLevel.WARN },
  'api.request.timeout': { level: LogLevel.ERROR },
  'api.request.rate_limit': { level: LogLevel.WARN },
  'api.request.error': { level: LogLevel.ERROR },

  // 編集操作
  'edit.description.start': { level: LogLevel.DEBUG },
  'edit.description.success': { level: LogLevel.INFO },
  'edit.undo.success': { level: LogLevel.INFO },
  'edit.redo.success': { level: LogLevel.INFO },
  'edit.reset.success': { level: LogLevel.INFO },

  // 共有・コピー
  'clipboard.copy.success': { level: LogLevel.INFO },
  'clipboard.copy.error': { level: LogLevel.ERROR },
  'share.start': { level: LogLevel.INFO },
  'share.success': { level: LogLevel.INFO },
  'share.cancelled': { level: LogLevel.INFO },
  'share.error': { level: LogLevel.ERROR },
};
```

#### ログ記録例

```typescript
// ✅ Good: 必要な情報のみ記録、個人情報を含めない
console.log('[conversion.start]', {
  imageSize: imageData.fileSize,
  imageType: imageData.type.toString(),
  resolution: `${imageData.width}x${imageData.height}`,
  timestamp: new Date().toISOString(),
});

// ❌ Bad: 画像データや生成テキストを含めない
console.log('[conversion.success]', {
  imageUri: imageData.uri,              // ❌ URIは記録しない
  descriptionText: description.text,    // ❌ テキスト内容は記録しない
});
```

### メトリクス収集

| メトリクス名 | 測定内容 | 目標値 | アラート閾値 |
|:-----------|:--------|:-------|:----------|
| conversion_success_rate | 変換成功率（日次） | > 95% | < 90% |
| conversion_duration_p50 | 変換処理時間（中央値） | < 5秒 | > 8秒 |
| conversion_duration_p95 | 変換処理時間（95パーセンタイル） | < 10秒 | > 15秒 |
| api_error_rate | APIエラー発生率 | < 5% | > 10% |
| network_error_rate | ネットワークエラー発生率 | < 3% | > 5% |
| app_crash_rate | アプリクラッシュ率 | < 0.1% | > 1% |
| memory_peak | ピークメモリ使用量 | < 150MB | > 200MB |
| edit_undo_count | Undo操作回数（平均） | - | - |
| edit_redo_count | Redo操作回数（平均） | - | - |
| cancel_rate | 変換キャンセル率 | < 10% | > 20% |

### トレース

```typescript
// 画像選択から変換完了までのエンドツーエンドトレース
const trace = {
  traceId: generateId(),
  spans: [
    {
      spanId: '1',
      name: 'image.select',
      startTime: 1234567890,
      duration: 450,   // ms
    },
    {
      spanId: '2',
      name: 'validation.security',
      startTime: 1234567900,
      duration: 50,
    },
    {
      spanId: '3',
      name: 'api.convert',
      startTime: 1234568000,
      duration: 4500,
      tags: {
        imageSize: 2048000,
        retryCount: 0,
      }
    }
  ],
  totalDuration: 5000,
};
```

## 8. Performance & Capacity

### パフォーマンス目標

| 項目 | 目標値 | 測定方法 | 根拠 |
|:-----|:------|:--------|:-----|
| 画像選択レスポンス | p95 < 500ms | 画像選択開始からプレビュー表示まで | ユーザーが待たされたと感じない閾値 |
| 変換処理時間 | p95 < 10秒 | API呼び出しから結果表示まで | 要件定義の非機能要件 |
| 変換処理時間（中央値） | p50 < 5秒 | 同上 | OpenAI Vision APIの平均レスポンス時間 |
| UI操作レスポンス | < 100ms | ボタンタップからフィードバック表示まで | 人間が即座と感じる閾値 |
| 初回レンダリング | < 500ms | アプリ起動から画面表示まで | コールドスタート時の体感速度 |
| メモリ使用量（アイドル） | < 50MB | アプリ起動後、操作なし | React Nativeアプリの標準値 |
| メモリ使用量（画像処理時） | < 150MB | 10MB画像読み込み時 | メモリ警告を回避 |
| メモリ使用量（ピーク） | < 200MB | すべての機能を使用した場合 | iOS/Androidのメモリ制限を考慮 |

### 最適化戦略

#### 画像処理最適化

```typescript
// 1. 画像の遅延読み込み
const ImagePreview: React.FC<ImagePreviewProps> = ({ uri }) => {
  return (
    <Image
      source={{ uri }}
      resizeMode="contain"
      fadeDuration={200}
      // ネイティブドライバー使用でパフォーマンス向上
    />
  );
};

// 2. Base64エンコードの最適化
async imageToBase64(uri: string): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
```

#### React最適化

```typescript
// 1. React.memo でコンポーネントの再レンダリング抑制
export const ImagePreview = React.memo<ImagePreviewProps>(
  ({ uri, onRemove }) => {
    return <Image source={{ uri }} />;
  },
  (prev, next) => prev.uri === next.uri
);

// 2. useCallback でハンドラーのメモ化
const handleConvert = useCallback(async () => {
  // ...
}, [imageDescription, convertImageUseCase]);

// 3. useMemo で計算結果のメモ化
const canShare = useMemo(() => {
  return imageDescription?.isConversionCompleted ?? false;
}, [imageDescription]);

// 4. Jotai の Derived Atoms で不要な再レンダリング防止
export const canShareAtom = atom((get) => {
  const imageDescription = get(imageDescriptionAtom);
  return imageDescription?.isConversionCompleted ?? false;
});
```

#### メモリリーク防止

```typescript
// 1. AbortController のクリーンアップ
useEffect(() => {
  return () => {
    abortController?.abort();
    setAbortController(null);
  };
}, [abortController]);

// 2. 画像データの明示的な破棄
const clearImageData = useCallback(() => {
  setImageDescription(null);
  setError(null);
  // メモリから画像データを解放
}, [setImageDescription, setError]);
```

### 容量計画

| 項目 | 想定値 | 根拠 |
|:-----|:------|:-----|
| 同時ユーザー数 | 1,000人 | 初期リリース想定 |
| 1日あたり変換回数 | 10,000回 | ユーザーあたり10回/日 |
| 1ヶ月あたり変換回数 | 300,000回 | 30日 × 10,000回/日 |
| 平均画像サイズ | 2MB | スマートフォンカメラの標準画質 |
| 月間転送量（アップロード） | 600GB | 300,000回 × 2MB |
| 月間トークン消費量 | 約150万トークン | 1画像あたり約5トークン（Vision API） |
| 月間APIコスト（OpenAI） | 約$30-50 | GPT-4 Vision APIの従量課金 |

## 9. Rollout & Rollback

### 段階リリース計画

#### Phase 1: 内部テスト（Week 1）

- **対象**: 開発チーム（5名）
- **期間**: 1週間
- **目的**: 機能動作確認、クリティカルバグ検出
- **成功基準**:
  - すべての基本機能が動作
  - クラッシュゼロ
  - 変換成功率 > 90%

#### Phase 2: Alpha Release（Week 2）

- **対象**: 社内テスター（20名）
- **配信**: TestFlight (iOS) / Internal Testing (Android)
- **期間**: 1週間
- **目的**: 実機での動作確認、UXフィードバック収集
- **成功基準**:
  - クラッシュ率 < 1%
  - 変換成功率 > 95%
  - 重大バグゼロ
  - ユーザーフィードバックでUX問題なし

#### Phase 3: Beta Release（Week 3-4）

- **対象**: 公開ベータテスター（100名）
- **配信**: TestFlight (iOS) / Open Testing (Android)
- **期間**: 2週間
- **目的**: 多様な環境での動作確認、パフォーマンス検証
- **成功基準**:
  - クラッシュ率 < 0.5%
  - 変換成功率 > 95%
  - p95変換時間 < 10秒
  - メモリ使用量 < 150MB
  - アクセシビリティ問題なし

#### Phase 4: GA Release（Week 5）

- **対象**: 一般ユーザー
- **配信**: App Store (iOS) / Google Play (Android)
- **監視期間**: 2週間（重点監視）
- **成功基準**: Phase 3と同等のメトリクス維持

### Go/No-Go判定基準

| 項目 | Go基準 | No-Go時の対応 |
|:-----|:------|:-------------|
| 変換成功率 | > 95% | 原因調査、APIパラメータ調整またはロールバック |
| クラッシュ率 | < 0.5% | クラッシュログ分析、緊急修正またはロールバック |
| p95変換時間 | < 10秒 | タイムアウト設定見直し、リトライ戦略調整 |
| メモリ使用量 | < 150MB | メモリリーク調査、画像処理最適化 |
| 重大バグ | ゼロ | バグ修正、再テスト |
| セキュリティ脆弱性 | ゼロ | 脆弱性修正、セキュリティレビュー |

### ロールバック手順

#### Step 1: 問題検知（5分以内）

```typescript
// アラート設定例
if (crashRate > 0.01) { // 1%を超えたら
  alert('CRITICAL: Crash rate exceeded threshold');
}

if (errorRate > 0.10) { // 10%を超えたら
  alert('WARNING: Error rate exceeded threshold');
}
```

#### Step 2: ロールバック判断（10分以内）

- クラッシュ率 > 1%: 即座にロールバック
- エラー率 > 15%: 即座にロールバック
- メモリクラッシュ報告複数: 即座にロールバック

#### Step 3: ロールバック実行（15分以内）

```bash
# App Store Connect / Google Play Console で前バージョンに戻す
# 緊急の場合はアプリ内でFeature Flagをオフにする

# Feature Flag でのロールバック例
ENABLE_IMAGE_CONVERSION=false
```

#### Step 4: 原因調査と修正

- ログ分析、クラッシュレポート確認
- 再現手順確認、修正実装
- 修正版のテスト実施
- 再リリース判断

## 10. Test Strategy

### テストカバレッジ目標

| レイヤー | カバレッジ目標 | 測定対象 | 優先度 |
|:---------|:--------------|:---------|:------|
| Domain層 | 100% | Entity, ValueObject, Domain Serviceのすべてのメソッドとブランチ | 最高 |
| Application層 | 95%以上 | UseCaseのすべてのパスとエラーハンドリング | 高 |
| Infrastructure層 | 80%以上 | Adapterの主要フロー、エラーケース | 中 |
| Presentation層 | 85%以上 | Component, Hook, Atoms（UIロジック） | 高 |
| 全体 | 90%以上 | プロジェクト全体の加重平均 | - |

### Unit Tests

#### Domain層テスト

**テスト対象**: Entity, ValueObject, Domain Service

```typescript
describe('ImageDescription Entity', () => {
  it('should complete conversion and initialize edit history', () => {
    const entity = new ImageDescription(id, imageData);
    const description = Description.create('テスト説明文');

    entity.completeConversion(description);

    expect(entity.isConversionCompleted).toBe(true);
    expect(entity.description?.text).toBe('テスト説明文');
    expect(entity.canUndo).toBe(false); // 初期状態ではUndo不可
  });

  it('should support edit with Undo/Redo', () => {
    const entity = new ImageDescription(id, imageData);
    entity.completeConversion(Description.create('元のテキスト'));

    // 編集
    entity.editDescription('編集後テキスト');
    expect(entity.description?.text).toBe('編集後テキスト');
    expect(entity.canUndo).toBe(true);
    expect(entity.hasBeenEdited).toBe(true);

    // Undo
    entity.undoEdit();
    expect(entity.description?.text).toBe('元のテキスト');
    expect(entity.canRedo).toBe(true);

    // Redo
    entity.redoEdit();
    expect(entity.description?.text).toBe('編集後テキスト');
  });

  it('should reset description to original', () => {
    const entity = new ImageDescription(id, imageData);
    entity.completeConversion(Description.create('元のテキスト'));
    entity.editDescription('編集後テキスト');

    entity.resetDescription();

    expect(entity.description?.text).toBe('元のテキスト');
    expect(entity.canUndo).toBe(false);
    expect(entity.hasBeenEdited).toBe(false);
  });
});

describe('EditHistory ValueObject', () => {
  it('should maintain maximum 50 histories', () => {
    let history = EditHistory.initialize(Description.create('initial'));

    // 50個の編集を追加
    for (let i = 1; i <= 50; i++) {
      history = history.push(Description.create(`edit ${i}`));
    }

    expect(history.size).toBe(50);

    // さらに追加すると古いものが削除される
    history = history.push(Description.create('edit 51'));
    expect(history.size).toBe(50);
  });

  it('should clear redo stack when new edit is pushed', () => {
    let history = EditHistory.initialize(Description.create('v1'));
    history = history.push(Description.create('v2'));
    history = history.push(Description.create('v3'));

    // Undoを2回実行（v1に戻る）
    history = history.undo();
    history = history.undo();
    expect(history.current().text).toBe('v1');
    expect(history.canRedo()).toBe(true);

    // 新しい編集を追加（Redoスタッククリア）
    history = history.push(Description.create('v4'));
    expect(history.canRedo()).toBe(false);
  });
});

describe('ImageData ValueObject - Boundary Tests', () => {
  it('should accept file size exactly at 10MB limit', () => {
    const result = ImageData.create({
      uri: 'test.jpg',
      type: 'image/jpeg',
      fileSize: 10485760, // 正確に10MB
      width: 1000,
      height: 1000,
    });
    expect(result.isSuccess).toBe(true);
  });

  it('should reject file size over 10MB limit', () => {
    const result = ImageData.create({
      uri: 'test.jpg',
      type: 'image/jpeg',
      fileSize: 10485761, // 10MB + 1バイト
      width: 1000,
      height: 1000,
    });
    expect(result.isFailure).toBe(true);
  });

  it('should accept minimum resolution 100x100', () => {
    const result = ImageData.create({
      uri: 'test.jpg',
      type: 'image/jpeg',
      fileSize: 1024,
      width: 100,
      height: 100,
    });
    expect(result.isSuccess).toBe(true);
  });

  it('should reject resolution below minimum', () => {
    const result = ImageData.create({
      uri: 'test.jpg',
      type: 'image/jpeg',
      fileSize: 1024,
      width: 99,
      height: 100,
    });
    expect(result.isFailure).toBe(true);
  });
});

describe('FileSecurityService - Magic Number Validation', () => {
  it('should detect JPEG by magic number FF D8 FF', async () => {
    const jpegBytes = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
    mockReadFileHeader.mockResolvedValue(jpegBytes);

    const result = await service.validate(imageDataWithJpegExtension);

    expect(result.isSuccess).toBe(true);
    expect(result.value.detectedFormat).toBe('JPEG');
  });

  it('should detect PNG by magic number 89 50 4E 47...', async () => {
    const pngBytes = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    mockReadFileHeader.mockResolvedValue(pngBytes);

    const result = await service.validate(imageDataWithPngExtension);

    expect(result.isSuccess).toBe(true);
    expect(result.value.detectedFormat).toBe('PNG');
  });

  it('should reject file with mismatched extension and magic number', async () => {
    // 拡張子はJPEGだがマジックナンバーはPNG
    const pngBytes = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    mockReadFileHeader.mockResolvedValue(pngBytes);

    const result = await service.validate(imageDataWithJpegExtension);

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('mismatch');
  });
});
```

#### Application層テスト

**テスト対象**: UseCase

```typescript
describe('ConvertImageToTextUseCase', () => {
  it('should successfully convert image to text', async () => {
    mockVisionRepository.convertToText.mockResolvedValue(
      Result.ok(Description.create('テスト説明文'))
    );

    const result = await useCase.execute(validImageData);

    expect(result.isSuccess).toBe(true);
    expect(result.value.description?.text).toBe('テスト説明文');
    expect(result.value.status.isCompleted()).toBe(true);
  });

  it('should handle API network error with retry', async () => {
    mockVisionRepository.convertToText
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce(Result.ok(Description.create('成功')));

    const result = await useCase.execute(validImageData);

    expect(result.isSuccess).toBe(true);
    expect(mockVisionRepository.convertToText).toHaveBeenCalledTimes(3);
  });

  it('should handle cancellation via AbortController', async () => {
    const abortController = new AbortController();

    const promise = useCase.execute(validImageData, abortController.signal);

    // 処理中にキャンセル
    setTimeout(() => abortController.abort(), 100);

    const result = await promise;

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('cancelled');
  });

  it('should handle empty API response', async () => {
    mockVisionRepository.convertToText.mockResolvedValue(
      Result.ok(Description.create(''))
    );

    const result = await useCase.execute(validImageData);

    expect(result.isFailure).toBe(true);
  });

  it('should fail after maximum retries', async () => {
    mockVisionRepository.convertToText.mockRejectedValue(
      new Error('API Error')
    );

    const result = await useCase.execute(validImageData);

    expect(result.isFailure).toBe(true);
    expect(mockVisionRepository.convertToText).toHaveBeenCalledTimes(3);
  });
});

describe('SelectImageUseCase - Security Validation', () => {
  it('should reject file failing security check', async () => {
    mockFileSecurityService.validate.mockResolvedValue(
      Result.fail({ isValid: false, error: 'Magic number mismatch' })
    );

    const result = await useCase.executeFromGallery();

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe('この形式のファイルは読み込めません');
  });

  it('should reject file exceeding size limit', async () => {
    mockImagePickerRepository.pickFromGallery.mockResolvedValue(
      Result.ok(ImageData.create({
        uri: 'test.jpg',
        type: 'image/jpeg',
        fileSize: 15 * 1024 * 1024, // 15MB
        width: 1000,
        height: 1000,
      }).value)
    );

    const result = await useCase.executeFromGallery();

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('10MB');
  });
});

describe('EditDescriptionUseCase', () => {
  it('should reject empty text', () => {
    const result = useCase.execute(imageDescription, '');

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('empty');
  });

  it('should reject text exceeding 10000 characters', () => {
    const longText = 'a'.repeat(10001);

    const result = useCase.execute(imageDescription, longText);

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('too long');
  });
});
```

### Integration Tests

**テスト対象**: Adapter実装

```typescript
describe('VisionApiAdapter Integration', () => {
  it('should call OpenAI API with correct parameters', async () => {
    const adapter = new VisionApiAdapter(mockApiConfig);

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'テスト説明文' } }]
      })
    });

    const result = await adapter.convertToText(validImageData);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/chat/completions'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': expect.stringContaining('Bearer'),
        }),
      })
    );
    expect(result.isSuccess).toBe(true);
  });

  it('should handle rate limit error without retry', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { code: 'rate_limit_exceeded' } })
    });

    const result = await adapter.convertToText(validImageData);

    expect(result.isFailure).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1); // リトライしない
  });

  it('should abort request when AbortSignal is triggered', async () => {
    const abortController = new AbortController();

    mockFetch.mockImplementation(() => {
      return new Promise((_, reject) => {
        setTimeout(() => {
          if (abortController.signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
          }
        }, 100);
      });
    });

    const promise = adapter.convertToText(validImageData, abortController.signal);
    abortController.abort();

    await expect(promise).rejects.toThrow('AbortError');
  });
});
```

### E2E Tests

**テストフレームワーク**: Detox (React Native推奨)

```typescript
describe('Image to Text E2E', () => {
  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('should complete full conversion flow', async () => {
    // 画像選択
    await element(by.id('gallery-button')).tap();
    await element(by.id('test-image-1')).tap();

    // プレビュー確認
    await expect(element(by.id('image-preview'))).toBeVisible();

    // 変換実行
    await element(by.id('convert-button')).tap();

    // 進行状況表示確認
    await expect(element(by.id('conversion-progress'))).toBeVisible();

    // 結果表示を待機
    await waitFor(element(by.id('description-text')))
      .toBeVisible()
      .withTimeout(15000);

    // コピー
    await element(by.id('copy-button')).tap();
    await expect(element(by.text('コピーしました'))).toBeVisible();
  });

  it('should handle edit with Undo/Redo', async () => {
    // ... 画像選択・変換 ...

    const originalText = await element(by.id('description-text')).getText();

    // 編集
    await element(by.id('description-text')).clearText();
    await element(by.id('description-text')).typeText('編集後のテキスト');

    // Undoボタンが有効化されていることを確認
    await expect(element(by.id('undo-button'))).toHaveToggleValue(true);

    // Undo
    await element(by.id('undo-button')).tap();
    const undoneText = await element(by.id('description-text')).getText();
    expect(undoneText).toBe(originalText);

    // Redoボタンが有効化されていることを確認
    await expect(element(by.id('redo-button'))).toHaveToggleValue(true);

    // Redo
    await element(by.id('redo-button')).tap();
    const redoneText = await element(by.id('description-text')).getText();
    expect(redoneText).toBe('編集後のテキスト');
  });

  it('should cancel conversion in progress', async () => {
    await element(by.id('gallery-button')).tap();
    await element(by.id('test-image-1')).tap();
    await element(by.id('convert-button')).tap();

    // キャンセルボタンが表示されるまで待機
    await waitFor(element(by.id('cancel-button')))
      .toBeVisible()
      .withTimeout(1000);

    // キャンセル
    await element(by.id('cancel-button')).tap();

    // キャンセルメッセージ確認
    await expect(element(by.text('変換がキャンセルされました'))).toBeVisible();
  });

  it('should handle network error with retry', async () => {
    // ネットワークを無効化
    await device.setNetworkConnection('none');

    await element(by.id('gallery-button')).tap();
    await element(by.id('test-image-1')).tap();
    await element(by.id('convert-button')).tap();

    // ネットワークエラーメッセージ確認
    await expect(element(by.text('ネットワークエラーが発生しました'))).toBeVisible();

    // ネットワークを有効化
    await device.setNetworkConnection('wifi');

    // 再試行
    await element(by.id('retry-button')).tap();

    // 成功を確認
    await waitFor(element(by.id('description-text')))
      .toBeVisible()
      .withTimeout(15000);
  });
});
```

### Performance Tests

```typescript
describe('Performance Tests', () => {
  it('should convert image within 10 seconds (p95)', async () => {
    const durations: number[] = [];

    // 20回実行して95パーセンタイルを測定
    for (let i = 0; i < 20; i++) {
      const startTime = Date.now();

      const result = await convertImageUseCase.execute(
        testImageData,
        abortSignal
      );

      const duration = Date.now() - startTime;
      durations.push(duration);

      expect(result.isSuccess).toBe(true);
    }

    durations.sort((a, b) => a - b);
    const p95Index = Math.floor(durations.length * 0.95);
    const p95Duration = durations[p95Index];

    expect(p95Duration).toBeLessThan(10000);
  });

  it('should not exceed memory limit with 10MB image', async () => {
    if (!performance.memory) {
      console.warn('performance.memory not available, skipping test');
      return;
    }

    const initialMemory = performance.memory.usedJSHeapSize;

    await selectImageUseCase.executeFromGallery();
    await convertImageUseCase.execute(largeImageData);

    const peakMemory = performance.memory.usedJSHeapSize;
    const memoryIncrease = (peakMemory - initialMemory) / 1024 / 1024; // MB

    expect(memoryIncrease).toBeLessThan(100);
  });

  it('should respond to UI actions within 100ms', async () => {
    const startTime = performance.now();

    // ボタンタップをシミュレート
    fireEvent.press(getByTestId('convert-button'));

    const endTime = performance.now();
    const duration = endTime - startTime;

    expect(duration).toBeLessThan(100);
  });
});
```

## 11. Implementation Timeline

### 推定工数（v1.1）

| フェーズ | 作業内容 | 工数 | 備考 |
|:--------|:--------|:-----|:-----|
| **Phase 1: Domain層** | Entity, ValueObject, Repository Interface, Domain Service | 5人日 | EditHistory, FileSecurityService追加 |
| **Phase 2: Application層** | UseCase実装、Result型実装 | 5人日 | Cancel, Edit, Undo/Redo, Reset追加 |
| **Phase 3: Infrastructure層** | Adapter実装、API統合、リトライ機構 | 6人日 | AbortController対応、マジックナンバーチェック |
| **Phase 4: Presentation層** | Jotai Atoms、Custom Hook、Component実装 | 11人日 | UI/UXデザインシステム実装、7コンポーネント、ダークモード対応 |
| **Phase 5: テスト** | 単体/統合/E2E/パフォーマンステスト | 9人日 | カバレッジ90%目標、境界値テスト、エラーハンドリングテスト |
| **Phase 6: iOS/Android固有対応** | 権限設定、ビルド設定、プラットフォーム固有バグ対応 | 2人日 | 実機テスト、ストア申請準備 |
| **Phase 7: ドキュメント** | コーディング規約、API仕様、運用手順 | 2人日 | README、開発者ガイド |
| **合計** | - | **40人日** | **約8週間（1名）、約4週間（2名）** |

### 詳細スケジュール（2名体制、4週間想定）

#### Week 1: Domain + Application層

| 日 | 担当者A | 担当者B |
|:---|:--------|:--------|
| Day 1-2 | ValueObject実装（ImageData, Description, ConversionStatus, EditHistory） | Repository Interface定義、Domain Service（FileSecurityService） |
| Day 3-4 | Entity実装（ImageDescription: Undo/Redo/Reset機能） | Domain Service（ImageValidationService）、単体テスト |
| Day 5 | Result型実装、Domain層テスト | Application層: SelectImageUseCase, ConvertImageToTextUseCase |

#### Week 2: Infrastructure + Presentation基盤

| 日 | 担当者A | 担当者B |
|:---|:--------|:--------|
| Day 6-7 | VisionApiAdapter（AbortController, リトライ機構） | ImagePickerAdapter, ClipboardAdapter, ShareAdapter |
| Day 8 | FileValidator（マジックナンバーチェック） | ApiConfig、環境変数設定 |
| Day 9-10 | Jotai Atoms定義、Derived Atoms | useImageConversion Hook実装 |

#### Week 3: Presentation UI/UX実装

| 日 | 担当者A | 担当者B |
|:---|:--------|:--------|
| Day 11-12 | デザインシステム（Colors, Typography, Spacing, Animations） | ImagePicker, ImagePreview, ConversionResult Component |
| Day 13 | EditToolbar, ConversionProgress Component | ActionButtons, ErrorMessage Component |
| Day 14-15 | ImageToTextScreen統合、ダークモード実装 | フォーカス管理、アクセシビリティ対応 |

#### Week 4: テスト + リリース準備

| 日 | 担当者A | 担当者B |
|:---|:--------|:--------|
| Day 16-17 | 単体テスト（Domain, Application層）、境界値テスト | 単体テスト（Infrastructure, Presentation層） |
| Day 18 | 統合テスト、エラーハンドリングテスト | E2Eテスト実装 |
| Day 19 | パフォーマンステスト、メモリリークチェック | iOS/Android実機テスト、権限設定 |
| Day 20 | バグ修正、ドキュメント整備 | ストア申請準備、リリースノート作成 |

### マイルストーン

| マイルストーン | 完了日 | 成果物 | 確認項目 |
|:-------------|:------|:------|:---------|
| M1: Domain層完成 | Day 5 | Entity, ValueObject, Repository Interface | 単体テスト100%パス、ビジネスロジック動作確認 |
| M2: Infrastructure層完成 | Day 8 | すべてのAdapter実装 | API連携動作確認、AbortController動作確認 |
| M3: 基本フロー動作 | Day 15 | 画像選択→変換→コピー/共有 | 基本フローのE2Eテストパス |
| M4: 拡張機能完成 | Day 15 | Undo/Redo, キャンセル, エラーハンドリング | すべての機能が動作 |
| M5: テスト完了 | Day 19 | カバレッジ90%達成 | すべてのテストパス、パフォーマンス目標達成 |
| M6: リリース準備完了 | Day 20 | Alpha版配信準備 | ストア申請ドキュメント完成 |

## 12. Dependencies & Prerequisites

### 必須ライブラリ

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-native": "^0.73.0",
    "jotai": "^2.6.0",
    "react-native-image-picker": "^7.0.0",
    "@react-native-clipboard/clipboard": "^1.13.0",
    "react-native-share": "^10.0.0",
    "react-native-dotenv": "^3.4.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-native": "^0.73.0",
    "typescript": "^5.3.0",
    "@testing-library/react-native": "^12.4.0",
    "@testing-library/jest-native": "^5.4.0",
    "jest": "^29.7.0",
    "detox": "^20.14.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "eslint": "^8.56.0",
    "prettier": "^3.1.0"
  }
}
```

### 環境変数設定

```bash
# .env.example（Gitにコミット）
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.openai.com

# .env（Gitignore対象、実際のAPIキーを設定）
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxx
OPENAI_BASE_URL=https://api.openai.com
```

```bash
# .gitignore
.env
.env.local
.env.production
```

### プラットフォーム固有設定

#### iOS (Info.plist)

```xml
<key>NSPhotoLibraryUsageDescription</key>
<string>写真を選択して内容を説明します</string>

<key>NSCameraUsageDescription</key>
<string>写真を撮影して内容を説明します</string>

<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsArbitraryLoads</key>
  <false/>
</dict>
```

#### Android (AndroidManifest.xml)

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
<uses-permission android:name="android.permission.INTERNET" />

<application
  android:usesCleartextTraffic="false">
  ...
</application>
```

### 開発環境セットアップ

```bash
# 1. リポジトリクローン
git clone <repository-url>
cd apps-to-tell-you

# 2. 依存パッケージインストール
npm install

# 3. iOS依存インストール（macOSのみ）
cd ios && pod install && cd ..

# 4. 環境変数設定
cp .env.example .env
# .envファイルを編集してAPIキーを設定

# 5. TypeScript型チェック
npm run type-check

# 6. Lintチェック
npm run lint

# 7. テスト実行
npm run test

# 8. アプリ起動
npm run ios    # iOS
npm run android # Android
```

## 13. UI/UX Implementation Details

### デザインシステム実装

#### カラーパレット

```typescript
// presentation/theme/colors.ts

export const lightTheme = {
  primary: '#007AFF',
  primaryDark: '#0051D5',
  primaryLight: '#4DA2FF',

  background: '#FFFFFF',
  backgroundSecondary: '#F2F2F7',
  backgroundTertiary: '#E5E5EA',

  textPrimary: '#000000',
  textSecondary: '#3C3C43',
  textTertiary: '#8E8E93',
  textDisabled: '#C7C7CC',

  border: '#C6C6C8',
  borderLight: '#E5E5EA',

  success: '#34C759',
  error: '#FF3B30',
  warning: '#FF9500',
  info: '#5AC8FA',

  overlay: 'rgba(0, 0, 0, 0.4)',
  shadow: 'rgba(0, 0, 0, 0.1)',
};

export const darkTheme = {
  primary: '#0A84FF',
  primaryDark: '#0077ED',
  primaryLight: '#409CFF',

  background: '#000000',
  backgroundSecondary: '#1C1C1E',
  backgroundTertiary: '#2C2C2E',

  textPrimary: '#FFFFFF',
  textSecondary: '#EBEBF5',
  textTertiary: '#8E8E93',
  textDisabled: '#48484A',

  border: '#38383A',
  borderLight: '#48484A',

  success: '#32D74B',
  error: '#FF453A',
  warning: '#FF9F0A',
  info: '#64D2FF',

  overlay: 'rgba(0, 0, 0, 0.6)',
  shadow: 'rgba(255, 255, 255, 0.1)',
};
```

#### タイポグラフィ

```typescript
// presentation/theme/typography.ts

export const typography = {
  h1: {
    fontSize: 34,
    fontWeight: '700' as const,
    lineHeight: 41,
    letterSpacing: 0.37,
  },
  h2: {
    fontSize: 28,
    fontWeight: '700' as const,
    lineHeight: 34,
    letterSpacing: 0.36,
  },
  h3: {
    fontSize: 22,
    fontWeight: '600' as const,
    lineHeight: 28,
    letterSpacing: 0.35,
  },
  body: {
    fontSize: 17,
    fontWeight: '400' as const,
    lineHeight: 22,
    letterSpacing: -0.41,
  },
  bodyBold: {
    fontSize: 17,
    fontWeight: '600' as const,
    lineHeight: 22,
    letterSpacing: -0.41,
  },
  caption: {
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 16,
    letterSpacing: 0,
  },
  button: {
    fontSize: 17,
    fontWeight: '600' as const,
    lineHeight: 22,
    letterSpacing: -0.41,
  },
};
```

#### スペーシング

```typescript
// presentation/theme/spacing.ts

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const borderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
};
```

### コンポーネントProps定義

#### EditToolbarProps

```typescript
type EditToolbarProps = {
  canUndo: boolean;
  canRedo: boolean;
  hasBeenEdited: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  testID?: string;
};
```

#### ConversionProgressProps

```typescript
type ConversionProgressProps = {
  isLoading: boolean;
  canCancel: boolean;
  progress?: number; // 0-100
  onCancel: () => void;
  message?: string;
  testID?: string;
};
```

### アクセシビリティ実装

#### スクリーンリーダー対応

```typescript
// コンポーネントのaccessibility属性例
<TouchableOpacity
  accessibilityRole="button"
  accessibilityLabel="ギャラリーから画像を選択"
  accessibilityHint="タップしてギャラリーから画像を選択します"
  accessible={true}
  onPress={selectFromGallery}
>
  <Text>ギャラリー</Text>
</TouchableOpacity>

<TextInput
  accessibilityLabel="変換されたテキスト"
  accessibilityHint="このテキストを編集できます"
  accessibilityRole="text"
  accessible={true}
  value={descriptionText}
  onChangeText={editDescription}
/>

<ActivityIndicator
  accessibilityLabel="画像を解析中"
  accessible={true}
/>
```

#### フォーカス管理

```typescript
// フォーカス順序の実装
const imagePickerRef = useRef<View>(null);
const convertButtonRef = useRef<TouchableOpacity>(null);
const editAreaRef = useRef<TextInput>(null);

// フォーカス移動
const focusNextElement = () => {
  if (imageUri) {
    convertButtonRef.current?.focus();
  } else {
    imagePickerRef.current?.focus();
  }
};
```

### ダークモード実装

```typescript
// presentation/theme/use-theme.hook.ts

import { useColorScheme } from 'react-native';
import { lightTheme, darkTheme, Theme } from './colors';

export const useTheme = (): Theme => {
  const colorScheme = useColorScheme();
  return colorScheme === 'dark' ? darkTheme : lightTheme;
};

// 使用例
const MyComponent = () => {
  const theme = useTheme();

  return (
    <View style={{ backgroundColor: theme.background }}>
      <Text style={{ color: theme.textPrimary }}>Hello</Text>
    </View>
  );
};
```

## 14. Risk Assessment & Mitigation

| リスク | 発生確率 | 影響度 | 対策 | 責任者 |
|:------|:---------|:-------|:-----|:------|
| OpenAI API利用制限・料金変更 | 中 | 大 | Repository抽象化により他APIへの切り替え容易化、使用量監視実装 | Tech Lead |
| Vision API精度不足 | 低 | 中 | 編集機能（Undo/Redo含む）提供、複数API候補の技術検証済み | Product Owner |
| ネットワーク不安定によるタイムアウト | 高 | 中 | リトライ機構、AbortControllerによるキャンセル機能、30秒タイムアウト、オフライン検知 | Tech Lead |
| 画像フォーマット非対応・偽装ファイル | 低 | 中 | ImageValidationService + FileSecurityServiceで多層検証、マジックナンバーチェック | Security Lead |
| メモリ不足（大容量画像） | 中 | 中 | 10MB厳密制限（10,485,760バイト）、画像圧縮オプション検討、メモリリーク防止 | Tech Lead |
| iOS/Android実装差異 | 中 | 中 | react-native-image-pickerの実績活用、各プラットフォームでテスト | Mobile Dev |
| Clean Architecture学習コスト | 中 | 小 | ドキュメント整備、ペアプログラミング、コードレビュー | Tech Lead |
| 編集履歴のメモリ消費 | 低 | 小 | EditHistoryで最大50履歴に制限、不変オブジェクトで効率的管理 | Tech Lead |
| キャンセル処理の複雑性 | 中 | 小 | AbortControllerの標準化、適切なクリーンアップ処理実装 | Tech Lead |
| ダークモード対応の工数 | 低 | 小 | useColorScheme活用、事前にカラーパレット定義 | UI/UX Designer |

## 15. Coding Standards

このプロジェクトは以下のコーディング規約に準拠する:

1. [TypeScript Deep Dive スタイルガイド](https://typescript-jp.gitbook.io/deep-dive/styleguide)（優先）
2. [Santoku（サントク）アプリ開発スタンダード](https://fintan-contents.github.io/mobile-app-crib-notes/react-native/santoku/development/implement/style-guide/typescript-style-guide/)

競合する場合はTypeScript Deep Diveを優先する。

### 命名規則

| 対象 | 規則 | 例 |
|:-----|:-----|:---|
| クラス | 名詞で先頭大文字（PascalCase） | `ImageDescription`, `VisionApiAdapter` |
| インターフェース | 先頭大文字（PascalCase）、`I`プレフィックスなし | `VisionRepository`, `ImagePickerRepository` |
| 型エイリアス | 先頭大文字（PascalCase） | `ImageType`, `ConversionResult` |
| Enum | PascalCase（名前とメンバ両方） | `ConversionStatusType.PENDING` |
| 関数・メソッド | 動詞から始まるcamelCase | `convertToText()`, `selectFromGallery()` |
| 変数 | 名詞でcamelCase | `imageData`, `descriptionText` |
| 真偽値 | `is`/`can`/`has`で開始 | `isLoading`, `canConvert`, `hasError` |
| 定数 | 全て大文字、単語間アンダースコア | `MAX_FILE_SIZE`, `DEFAULT_RETRY_COUNT` |
| Privateフィールド | アンダースコアで開始 | `_imageDescription`, `_isLoading` |
| ファイル名 | ケバブケース + 種別サフィックス | `image-description.entity.ts`, `vision-api.adapter.ts` |

### 禁止事項

- ❌ 計算式内でインクリメント・デクリメント演算子の使用
- ❌ フィールドを一時変数として使用
- ❌ 配列戻り値で`null`/`undefined`を返す（空配列`[]`を返す）
- ❌ コンストラクタ内でインスタンスメソッド呼び出し
- ❌ `try-catch`を条件分岐目的で使用
- ❌ グローバル変数の定義
- ❌ プロトタイプの拡張

### 推奨事項

```typescript
// ✅ Good: constを優先
const maxRetries = 3;
const imageData = ImageData.create(params);

// ❌ Bad: letの不必要な使用
let maxRetries = 3; // 再代入しない場合

// ✅ Good: Early Return
if (!imageData) {
  return Result.fail('No image data');
}
// メインロジック

// ❌ Bad: ネストが深い
if (imageData) {
  if (validationResult.isSuccess) {
    // メインロジック
  }
}

// ✅ Good: 明示的な型定義
const convertToText = async (imageData: ImageData): Promise<Result<Description>> => {
  // ...
};

// ❌ Bad: 暗黙的な型
const convertToText = async (imageData) => {
  // ...
};
```

---

**文書管理**
- 作成者: Senior React Native Engineer
- レビュー者: Tech Lead, Product Owner
- 承認者: CTO
- 次回レビュー予定: 実装開始前（2026-01-15）
