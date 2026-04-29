import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PublicFormLog } from '@prisma/client';

export type ExportFormat = 'xlsx' | 'csv';

/**
 * Logical column keys the user can pick in the export modal.
 * Format: either a built-in metadata key, or `payload:<key>` for arbitrary
 * payload keys.
 */
export const BUILT_IN_COLUMNS = [
  'created_at',
  'public_token',
  'submission_id',
  'landing_page_url',
  'referer',
  'user_agent',
  'ip_address',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'payload_size',
] as const;

export type BuiltInColumn = (typeof BUILT_IN_COLUMNS)[number];

export interface ExportColumnsRequest {
  /** Built-in metadata columns (string list, snake_case). */
  builtIn: BuiltInColumn[];
  /** Arbitrary payload keys to dump as their own column. */
  payloadKeys: string[];
}

interface BuiltColumn {
  header: string;
  /** Resolves the value for a single log row. */
  resolve: (log: PublicFormLog) => unknown;
}

@Injectable()
export class LogExportService {
  buildExport(
    logs: PublicFormLog[],
    cols: ExportColumnsRequest,
    format: ExportFormat,
  ): Promise<{ buffer: Buffer; filename: string; mime: string }> {
    const columns = this.assembleColumns(cols);
    const filenameBase = `public-form-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;

    if (format === 'csv') {
      return Promise.resolve({
        buffer: Buffer.from(this.buildCsv(logs, columns), 'utf8'),
        filename: `${filenameBase}.csv`,
        mime: 'text/csv; charset=utf-8',
      });
    }
    return this.buildXlsx(logs, columns).then((buffer) => ({
      buffer,
      filename: `${filenameBase}.xlsx`,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }));
  }

  private assembleColumns(req: ExportColumnsRequest): BuiltColumn[] {
    const cols: BuiltColumn[] = [];

    const builtInOrder: BuiltInColumn[] = [
      'created_at',
      'public_token',
      'submission_id',
      'landing_page_url',
      'referer',
      'user_agent',
      'ip_address',
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'payload_size',
    ];
    for (const key of builtInOrder) {
      if (!req.builtIn.includes(key)) continue;
      cols.push({ header: key, resolve: (l) => this.resolveBuiltIn(l, key) });
    }

    for (const k of req.payloadKeys) {
      cols.push({
        header: k,
        resolve: (l) => {
          const p = l.formPayload as Record<string, unknown> | null;
          if (!p) return '';
          const v = p[k];
          if (v === null || v === undefined) return '';
          return typeof v === 'object' ? JSON.stringify(v) : v;
        },
      });
    }

    return cols;
  }

  private resolveBuiltIn(log: PublicFormLog, key: BuiltInColumn): unknown {
    switch (key) {
      case 'created_at':
        return log.createdAt.toISOString();
      case 'public_token':
        return log.publicToken;
      case 'submission_id':
        return log.submissionId;
      case 'landing_page_url':
        return log.landingPageUrl ?? '';
      case 'referer':
        return log.referer ?? '';
      case 'user_agent':
        return log.userAgent ?? '';
      case 'ip_address':
        return log.ipAddress ?? '';
      case 'utm_source':
        return log.utmSource ?? '';
      case 'utm_medium':
        return log.utmMedium ?? '';
      case 'utm_campaign':
        return log.utmCampaign ?? '';
      case 'payload_size':
        return log.formPayloadSize;
      default:
        return '';
    }
  }

  private buildCsv(logs: PublicFormLog[], cols: BuiltColumn[]): string {
    const lines: string[] = [];
    lines.push(cols.map((c) => csvCell(c.header)).join(','));
    for (const log of logs) {
      lines.push(cols.map((c) => csvCell(c.resolve(log))).join(','));
    }
    // Excel-friendly UTF-8 BOM so accents render properly on opening.
    return '\uFEFF' + lines.join('\r\n');
  }

  private async buildXlsx(logs: PublicFormLog[], cols: BuiltColumn[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Public Form Logger';
    wb.created = new Date();
    const ws = wb.addWorksheet('Logs');
    ws.columns = cols.map((c) => ({ header: c.header, key: c.header, width: 24 }));
    for (const log of logs) {
      const row: Record<string, unknown> = {};
      cols.forEach((c) => {
        row[c.header] = c.resolve(log);
      });
      ws.addRow(row);
    }
    ws.getRow(1).font = { bold: true };
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf as ArrayBuffer);
  }
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
