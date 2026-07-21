import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";

export interface DataTableProps<TData> {
  caption: string;
  columns: ColumnDef<TData, any>[];
  data: readonly TData[];
  emptyMessage: string;
  getRowId?: (row: TData, index: number) => string;
}

export function DataTable<TData>({ caption, columns, data, emptyMessage, getRowId }: DataTableProps<TData>) {
  const table = useReactTable({
    data: data as TData[],
    columns,
    getCoreRowModel: getCoreRowModel(),
    ...(getRowId ? { getRowId } : {}),
  });

  if (data.length === 0) {
    return <p className="data-table-empty">{emptyMessage}</p>;
  }

  return (
    <table className="data-table">
      <caption>{caption}</caption>
      <thead>
        {table.getHeaderGroups().map((headerGroup) => (
          <tr key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <th key={header.id} scope="col">
                {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
