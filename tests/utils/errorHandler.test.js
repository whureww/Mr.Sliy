/**
 * 错误处理模块测试
 */

const {
  ErrorType,
  AppError,
  classifyError,
  logError,
  handleError,
  createError,
  asyncErrorHandler
} = require('../../src/utils/errorHandler');

describe('errorHandler', () => {
  describe('AppError', () => {
    test('should create an AppError with correct properties', () => {
      const error = new AppError(ErrorType.VALIDATION_ERROR, 'Validation failed', { field: 'username' });
      expect(error.name).toBe('AppError');
      expect(error.type).toBe(ErrorType.VALIDATION_ERROR);
      expect(error.message).toBe('Validation failed');
      expect(error.details).toEqual({ field: 'username' });
      expect(error.errorId).toBeDefined();
    });

    test('should serialize to JSON correctly', () => {
      const error = new AppError(ErrorType.DATABASE_ERROR, 'DB error');
      const json = error.toJSON();
      expect(json.success).toBe(false);
      expect(json.type).toBe(ErrorType.DATABASE_ERROR);
      expect(json.message).toBe('DB error');
    });
  });

  describe('classifyError', () => {
    test('should classify network error by code', () => {
      const error = new Error('Connection refused');
      error.code = 'ECONNREFUSED';
      expect(classifyError(error)).toBe(ErrorType.NETWORK_ERROR);
    });

    test('should classify timeout error by code', () => {
      const error = new Error('Timeout');
      error.code = 'ETIMEDOUT';
      expect(classifyError(error)).toBe(ErrorType.TIMEOUT_ERROR);
    });

    test('should classify database error by message', () => {
      const error = new Error('SQL error: database not found');
      expect(classifyError(error)).toBe(ErrorType.DATABASE_ERROR);
    });

    test('should classify validation error by message', () => {
      const error = new Error('参数验证失败');
      expect(classifyError(error)).toBe(ErrorType.VALIDATION_ERROR);
    });

    test('should return RUNTIME_ERROR for unknown error', () => {
      const error = new Error('Unknown error');
      expect(classifyError(error)).toBe(ErrorType.RUNTIME_ERROR);
    });
  });

  describe('createError', () => {
    test('should create an AppError', () => {
      const error = createError(ErrorType.NOT_FOUND_ERROR, 'Not found', { resource: 'user' });
      expect(error instanceof AppError).toBe(true);
      expect(error.type).toBe(ErrorType.NOT_FOUND_ERROR);
    });
  });

  describe('asyncErrorHandler', () => {
    test('should wrap async function and catch errors', async () => {
      const fn = async () => {
        throw new Error('Test error');
      };

      const wrappedFn = asyncErrorHandler(fn);
      
      await expect(wrappedFn()).rejects.toThrow();
    });

    test('should return result on success', async () => {
      const fn = async () => 'success';
      const wrappedFn = asyncErrorHandler(fn);
      const result = await wrappedFn();
      expect(result).toBe('success');
    });
  });

  describe('handleError', () => {
    test('should handle error and return status code', () => {
      const error = createError(ErrorType.VALIDATION_ERROR, 'Validation failed');
      const result = handleError(error);
      expect(result.statusCode).toBe(400);
      expect(result.type).toBe(ErrorType.VALIDATION_ERROR);
    });

    test('should return 500 for runtime error', () => {
      const error = createError(ErrorType.RUNTIME_ERROR, 'Runtime error');
      const result = handleError(error);
      expect(result.statusCode).toBe(500);
    });
  });
});