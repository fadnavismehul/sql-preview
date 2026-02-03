import { ExportService } from '../../services/ExportService';
import { QueryExecutor } from '../../core/execution/QueryExecutor';

describe('ExportService Tests', () => {
  let exportService: ExportService;
  let queryExecutorMock: QueryExecutor;

  beforeEach(() => {
    queryExecutorMock = {
      execute: jest.fn(),
    } as unknown as QueryExecutor;
    exportService = new ExportService(queryExecutorMock);
  });

  describe('_escapeCsv', () => {
    it('should stringify objects for CSV', () => {
      const escapeCsv = (exportService as any)._escapeCsv.bind(exportService);
      const obj = { key: 'value', num: 1 };
      const result = escapeCsv(obj, ',');
      // Since JSON.stringify order isn't guaranteed in all environments (though usually consistent for simple objects), check parse
      // But JSON.stringify output is standard.
      expect(result).toBe('"{""key"":""value"",""num"":1}"');
    });

    it('should handle strings normally', () => {
      const escapeCsv = (exportService as any)._escapeCsv.bind(exportService);
      expect(escapeCsv('test', ',')).toBe('test');
    });

    it('should escape CSV injection characters', () => {
      const escapeCsv = (exportService as any)._escapeCsv.bind(exportService);
      // The function prepends a single quote to prevent execution
      expect(escapeCsv('=SUM(1+1)', ',')).toBe("'=SUM(1+1)");
    });
  });
});
