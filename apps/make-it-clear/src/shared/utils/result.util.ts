/**
 * Result型: 成功/失敗を表現する型
 * エラーハンドリングをResult型で統一することで、例外を使わない安全な設計を実現
 */
export class Result<T> {
  public readonly isSuccess: boolean;
  public readonly isFailure: boolean;
  private readonly _value?: T;
  private readonly _error?: string;

  private constructor(isSuccess: boolean, error?: string, value?: T) {
    if (isSuccess && error) {
      throw new Error('Success result cannot have error');
    }
    if (!isSuccess && !error) {
      throw new Error('Failure result must have error message');
    }

    this.isSuccess = isSuccess;
    this.isFailure = !isSuccess;
    this._error = error;
    this._value = value;

    Object.freeze(this);
  }

  public get value(): T {
    if (!this.isSuccess) {
      throw new Error('Cannot get value from failed result');
    }
    return this._value as T;
  }

  public get error(): string {
    if (this.isSuccess) {
      throw new Error('Cannot get error from successful result');
    }
    return this._error as string;
  }

  public static ok<U>(value?: U): Result<U> {
    return new Result<U>(true, undefined, value);
  }

  public static fail<U>(error: string): Result<U> {
    return new Result<U>(false, error);
  }
}
