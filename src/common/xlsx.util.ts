import { Workbook } from 'exceljs';
import type { Response } from 'express';

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Build a single-sheet .xlsx buffer — shared by the admin export endpoints. */
export async function buildXlsxBuffer(
  sheetName: string,
  columns: { header: string; key: string; width?: number }[],
  rows: Record<string, unknown>[],
): Promise<Buffer> {
  const wb = new Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns;
  ws.getRow(1).font = { bold: true };
  ws.addRows(rows);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export function sendXlsx(res: Response, buf: Buffer, filename: string): void {
  res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
}
