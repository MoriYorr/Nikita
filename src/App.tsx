import { useState, useCallback, useMemo } from 'react';
import Papa from 'papaparse';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, ResponsiveContainer, PieChart, Pie, Cell,
  ScatterChart, Scatter, ZAxis
} from 'recharts';

// ============ TYPES ============
interface CSVData {
  headers: string[];
  rows: Record<string, string>[];
}

interface ColumnStats {
  name: string;
  type: 'numeric' | 'text' | 'date';
  count: number;
  missing: number;
  unique: number;
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  stdDev?: number;
  topValues?: { value: string; count: number }[];
}

interface SuspiciousRow {
  rowIndex: number;
  reasons: string[];
  data: Record<string, string>;
}

// ============ SAMPLE CSV ============
const SAMPLE_CSV = `id,name,age,salary,department,start_date,score
1,Алексей Иванов,28,85000,IT,2020-03-15,92
2,Мария Петрова,34,120000,HR,2018-07-22,88
3,Дмитрий Сидоров,45,150000,IT,2015-01-10,95
4,Елена Козлова,29,90000,Маркетинг,2021-06-01,78
5,Сергей Волков,,95000,IT,2019-11-30,
6,Анна Новикова,31,,Финансы,2020-08-14,85
7,Павел Морозов,52,200000,IT,2010-04-20,91
8,Ольга Соколова,27,75000,HR,2022-01-05,82
9,Иван Лебедев,38,130000,Маркетинг,2017-09-18,89
10,Наталья Попова,33,110000,Финансы,2019-03-25,76
11,Алексей Иванов,28,85000,IT,2020-03-15,92
12,Виктор Кузнецов,41,140000,IT,2016-12-03,94
13,Екатерина Смирнова,26,70000,HR,2023-02-14,80
14,Андрей Попов,150,95000,IT,2020-05-20,87
15,Татьяна Васильева,36,-5000,Финансы,2018-10-11,105
16,Михаил Михайлов,43,160000,IT,2014-07-08,90
17,Юлия Фёдорова,30,88000,Маркетинг,2021-04-17,83
18,Николай Ершов,29,92000,HR,,79
19,Светлана Романова,35,125000,Финансы,2019-08-22,86
20,Артём Григорьев,47,180000,IT,2012-01-30,97`;

// ============ UTILITY FUNCTIONS ============
function isNumeric(value: string): boolean {
  if (!value || value.trim() === '') return false;
  return !isNaN(Number(value)) && isFinite(Number(value));
}

function getColumnValues(rows: Record<string, string>[], col: string): string[] {
  return rows.map(r => r[col] || '').filter(v => v.trim() !== '');
}

function getNumericValues(rows: Record<string, string>[], col: string): number[] {
  return getColumnValues(rows, col)
    .filter(v => isNumeric(v))
    .map(v => Number(v));
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stdDev(arr: number[], mean: number): number {
  const squaredDiffs = arr.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / arr.length);
}

function analyzeColumn(rows: Record<string, string>[], col: string): ColumnStats {
  const allValues = rows.map(r => r[col] || '');
  const nonEmpty = allValues.filter(v => v.trim() !== '');
  const numericVals = getNumericValues(rows, col);
  const unique = new Set(nonEmpty).size;

  const isNum = numericVals.length > nonEmpty.length * 0.7 && numericVals.length > 0;

  const stats: ColumnStats = {
    name: col,
    type: isNum ? 'numeric' : 'text',
    count: nonEmpty.length,
    missing: allValues.length - nonEmpty.length,
    unique,
  };

  if (isNum) {
    const mean = numericVals.reduce((a, b) => a + b, 0) / numericVals.length;
    stats.min = Math.min(...numericVals);
    stats.max = Math.max(...numericVals);
    stats.mean = Math.round(mean * 100) / 100;
    stats.median = median(numericVals);
    stats.stdDev = Math.round(stdDev(numericVals, mean) * 100) / 100;
  } else {
    const valueCounts: Record<string, number> = {};
    nonEmpty.forEach(v => { valueCounts[v] = (valueCounts[v] || 0) + 1; });
    stats.topValues = Object.entries(valueCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([value, count]) => ({ value, count }));
  }

  return stats;
}

function findSuspiciousRows(rows: Record<string, string>[], headers: string[]): SuspiciousRow[] {
  const suspicious: SuspiciousRow[] = [];
  const numericCols = headers.filter(h => {
    const vals = getNumericValues(rows, h);
    return vals.length > rows.length * 0.5;
  });

  // Calculate stats for outlier detection
  const colStats: Record<string, { mean: number; std: number; min: number; max: number }> = {};
  numericCols.forEach(col => {
    const vals = getNumericValues(rows, col);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    colStats[col] = {
      mean,
      std: stdDev(vals, mean),
      min: Math.min(...vals),
      max: Math.max(...vals),
    };
  });

  // Check for duplicates
  const rowStrings = rows.map(r => JSON.stringify(r));
  const seen = new Map<string, number>();
  rowStrings.forEach((str, idx) => {
    if (seen.has(str)) {
      const origIdx = seen.get(str)!;
      suspicious.push({
        rowIndex: idx + 1,
        reasons: [`Дубликат строки ${origIdx + 1}`],
        data: rows[idx],
      });
    } else {
      seen.set(str, idx);
    }
  });

  rows.forEach((row, idx) => {
    const reasons: string[] = [];

    // Check for missing values
    headers.forEach(h => {
      if (!row[h] || row[h].trim() === '') {
        reasons.push(`Пропуск в столбце "${h}"`);
      }
    });

    // Check for outliers (beyond 2 std deviations)
    numericCols.forEach(col => {
      const val = row[col];
      if (val && isNumeric(val)) {
        const numVal = Number(val);
        const { mean, std } = colStats[col];
        if (std > 0 && Math.abs(numVal - mean) > 2 * std) {
          reasons.push(`Выброс в "${col}": ${numVal} (μ=${Math.round(mean)}, σ=${Math.round(std)})`);
        }
      }
      // Check for negative values in columns that should be positive
      if (val && isNumeric(val) && Number(val) < 0 && !col.toLowerCase().includes('delta') && !col.toLowerCase().includes('change')) {
        reasons.push(`Отрицательное значение в "${col}": ${val}`);
      }
      // Check for unreasonably large values
      if (val && isNumeric(val) && Number(val) > 1000000) {
        reasons.push(`Подозрительно большое значение в "${col}": ${val}`);
      }
    });

    // Check for age-like columns with unreasonable values
    headers.forEach(h => {
      if (h.toLowerCase().includes('age') || h.toLowerCase().includes('возраст')) {
        const val = row[h];
        if (val && isNumeric(val)) {
          const age = Number(val);
          if (age < 0 || age > 120) {
            reasons.push(`Нереалистичный возраст: ${val}`);
          }
        }
      }
    });

    if (reasons.length > 0) {
      // Avoid duplicate entries (already added as duplicates)
      const existing = suspicious.find(s => s.rowIndex === idx + 1);
      if (existing) {
        existing.reasons.push(...reasons);
      } else {
        suspicious.push({ rowIndex: idx + 1, reasons, data: row });
      }
    }
  });

  return suspicious;
}

// ============ COMPONENTS ============
const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#f43f5e', '#84cc16'];

function StatsCard({ title, value, icon, color }: { title: string; value: string | number; icon: string; color: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-white text-xl ${color}`}>
        <i className={`fas ${icon}`}></i>
      </div>
      <div>
        <p className="text-sm text-gray-500">{title}</p>
        <p className="text-2xl font-bold text-gray-800">{value}</p>
      </div>
    </div>
  );
}

function ColumnStatsTable({ stats }: { stats: ColumnStats[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left p-3 font-semibold text-gray-600">Столбец</th>
            <th className="text-left p-3 font-semibold text-gray-600">Тип</th>
            <th className="text-right p-3 font-semibold text-gray-600">Заполнено</th>
            <th className="text-right p-3 font-semibold text-gray-600">Пропуски</th>
            <th className="text-right p-3 font-semibold text-gray-600">Уникальные</th>
            <th className="text-right p-3 font-semibold text-gray-600">Мин</th>
            <th className="text-right p-3 font-semibold text-gray-600">Макс</th>
            <th className="text-right p-3 font-semibold text-gray-600">Среднее</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((col, i) => (
            <tr key={col.name} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
              <td className="p-3 font-medium text-gray-800">{col.name}</td>
              <td className="p-3">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  col.type === 'numeric' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                }`}>
                  {col.type === 'numeric' ? 'Число' : 'Текст'}
                </span>
              </td>
              <td className="p-3 text-right">{col.count}</td>
              <td className="p-3 text-right">
                {col.missing > 0 ? (
                  <span className="text-red-600 font-medium">{col.missing}</span>
                ) : (
                  <span className="text-green-600">0</span>
                )}
              </td>
              <td className="p-3 text-right">{col.unique}</td>
              <td className="p-3 text-right">{col.min ?? '—'}</td>
              <td className="p-3 text-right">{col.max ?? '—'}</td>
              <td className="p-3 text-right">{col.mean ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DistributionChart({ data, colName }: { data: { range: string; count: number }[]; colName: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <h4 className="font-semibold text-gray-700 mb-3">Распределение: {colName}</h4>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="range" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} name="Количество" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function MissingValuesChart({ stats }: { stats: ColumnStats[] }) {
  const data = stats
    .filter(s => s.missing > 0)
    .map(s => ({ name: s.name, missing: s.missing }));

  if (data.length === 0) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <h4 className="font-semibold text-gray-700 mb-3">Пропущенные значения</h4>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis type="number" tick={{ fontSize: 11 }} />
          <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
          <Tooltip />
          <Bar dataKey="missing" fill="#f43f5e" radius={[0, 4, 4, 0]} name="Пропуски" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CategoryPieChart({ data, title }: { data: { name: string; value: number }[]; title: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <h4 className="font-semibold text-gray-700 mb-3">{title}</h4>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            outerRadius={90}
            dataKey="value"
            label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
            labelLine={true}
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function ScatterPlot({ rows, xCol, yCol }: { rows: Record<string, string>[]; xCol: string; yCol: string }) {
  const data = rows
    .filter(r => isNumeric(r[xCol]) && isNumeric(r[yCol]))
    .map(r => ({ x: Number(r[xCol]), y: Number(r[yCol]) }));

  if (data.length === 0) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <h4 className="font-semibold text-gray-700 mb-3">Корреляция: {xCol} vs {yCol}</h4>
      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="x" name={xCol} tick={{ fontSize: 11 }} label={{ value: xCol, position: 'bottom', offset: -5 }} />
          <YAxis dataKey="y" name={yCol} tick={{ fontSize: 11 }} label={{ value: yCol, angle: -90, position: 'insideLeft' }} />
          <ZAxis range={[50]} />
          <Tooltip cursor={{ strokeDasharray: '3 3' }} />
          <Scatter data={data} fill="#8b5cf6" fillOpacity={0.6} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

function SuspiciousRowsTable({ rows, headers }: { rows: SuspiciousRow[]; headers: string[] }) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  if (rows.length === 0) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
        <i className="fas fa-check-circle text-green-500 text-3xl mb-2"></i>
        <p className="text-green-700 font-medium">Подозрительных строк не найдено!</p>
        <p className="text-green-600 text-sm">Все данные выглядят корректно.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-4">
        <span className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-sm font-medium">
          {rows.length} подозрительных строк
        </span>
      </div>
      {rows.map((row) => (
        <div key={row.rowIndex} className="bg-white rounded-xl shadow-sm border border-red-100 overflow-hidden">
          <div
            className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition"
            onClick={() => setExpandedRow(expandedRow === row.rowIndex ? null : row.rowIndex)}
          >
            <div className="flex items-center gap-3">
              <span className="bg-red-100 text-red-700 px-2 py-1 rounded text-xs font-bold">
                Строка {row.rowIndex}
              </span>
              <div className="flex flex-wrap gap-1">
                {row.reasons.slice(0, 2).map((reason, i) => (
                  <span key={i} className="bg-orange-50 text-orange-700 px-2 py-0.5 rounded text-xs">
                    {reason.length > 40 ? reason.slice(0, 40) + '...' : reason}
                  </span>
                ))}
                {row.reasons.length > 2 && (
                  <span className="text-gray-500 text-xs">+{row.reasons.length - 2} ещё</span>
                )}
              </div>
            </div>
            <i className={`fas fa-chevron-${expandedRow === row.rowIndex ? 'up' : 'down'} text-gray-400`}></i>
          </div>
          {expandedRow === row.rowIndex && (
            <div className="border-t border-gray-100 p-4 bg-gray-50">
              <div className="mb-3">
                <p className="text-sm font-semibold text-gray-600 mb-2">Причины:</p>
                <ul className="space-y-1">
                  {row.reasons.map((reason, i) => (
                    <li key={i} className="text-sm text-red-600 flex items-center gap-2">
                      <i className="fas fa-exclamation-triangle text-xs"></i>
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-600 mb-2">Данные строки:</p>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {headers.map(h => (
                    <div key={h} className="bg-white rounded p-2 border">
                      <span className="text-xs text-gray-500 block">{h}</span>
                      <span className={`text-sm font-medium ${!row.data[h] ? 'text-red-500 italic' : 'text-gray-800'}`}>
                        {row.data[h] || '— пусто —'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ============ MAIN APP ============
export default function App() {
  const [data, setData] = useState<CSVData | null>(null);
  const [fileName, setFileName] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'charts' | 'suspicious'>('overview');
  const [selectedNumericX, setSelectedNumericX] = useState('');
  const [selectedNumericY, setSelectedNumericY] = useState('');

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields || [];
        const rows = results.data as Record<string, string>[];
        setData({ headers, rows });
        // Set default numeric columns for scatter
        const numCols = headers.filter(h => getNumericValues(rows, h).length > rows.length * 0.5);
        if (numCols.length >= 2) {
          setSelectedNumericX(numCols[0]);
          setSelectedNumericY(numCols[1]);
        }
      },
    });
  }, []);

  const handleLoadSample = useCallback(() => {
    setFileName('sample_data.csv');
    Papa.parse(SAMPLE_CSV, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields || [];
        const rows = results.data as Record<string, string>[];
        setData({ headers, rows });
        const numCols = headers.filter(h => getNumericValues(rows, h).length > rows.length * 0.5);
        if (numCols.length >= 2) {
          setSelectedNumericX(numCols[0]);
          setSelectedNumericY(numCols[1]);
        }
      },
    });
  }, []);

  const columnStats = useMemo(() => {
    if (!data) return [];
    return data.headers.map(h => analyzeColumn(data.rows, h));
  }, [data]);

  const suspiciousRows = useMemo(() => {
    if (!data) return [];
    return findSuspiciousRows(data.rows, data.headers);
  }, [data]);

  const numericStats = useMemo(() => {
    return columnStats.filter(s => s.type === 'numeric');
  }, [columnStats]);

  const textStats = useMemo(() => {
    return columnStats.filter(s => s.type === 'text');
  }, [columnStats]);

  const distributionData = useMemo(() => {
    if (!data || !selectedNumericX) return [];
    const vals = getNumericValues(data.rows, selectedNumericX);
    if (vals.length === 0) return [];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const binCount = Math.min(10, Math.ceil(Math.sqrt(vals.length)));
    const binWidth = (max - min) / binCount || 1;
    const bins: { range: string; count: number }[] = [];
    for (let i = 0; i < binCount; i++) {
      const lo = min + i * binWidth;
      const hi = lo + binWidth;
      const count = vals.filter(v => v >= lo && (i === binCount - 1 ? v <= hi : v < hi)).length;
      bins.push({ range: `${Math.round(lo)}-${Math.round(hi)}`, count });
    }
    return bins;
  }, [data, selectedNumericX]);

  const totalMissing = useMemo(() => {
    return columnStats.reduce((sum, s) => sum + s.missing, 0);
  }, [columnStats]);

  if (!data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
        <div className="max-w-lg w-full">
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-file-csv text-indigo-600 text-3xl"></i>
            </div>
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Сводка по CSV</h1>
            <p className="text-gray-500">Загрузите CSV-файл для анализа данных, построения графиков и поиска подозрительных строк</p>
          </div>

          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
            <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center hover:border-indigo-300 transition">
              <i className="fas fa-cloud-upload-alt text-gray-400 text-4xl mb-4"></i>
              <p className="text-gray-600 mb-4">Перетащите CSV-файл или нажмите для выбора</p>
              <label className="inline-block bg-indigo-600 text-white px-6 py-3 rounded-lg font-medium cursor-pointer hover:bg-indigo-700 transition shadow-sm">
                <i className="fas fa-folder-open mr-2"></i>Выбрать файл
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            <div className="mt-6 text-center">
              <p className="text-gray-400 text-sm mb-3">или</p>
              <button
                onClick={handleLoadSample}
                className="text-indigo-600 hover:text-indigo-700 font-medium text-sm transition"
              >
                <i className="fas fa-database mr-1"></i>
                Загрузить пример данных
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-3 text-center">
            <div className="bg-white/80 rounded-lg p-3 border">
              <i className="fas fa-chart-bar text-indigo-500 text-lg mb-1"></i>
              <p className="text-xs text-gray-600">Графики</p>
            </div>
            <div className="bg-white/80 rounded-lg p-3 border">
              <i className="fas fa-search text-purple-500 text-lg mb-1"></i>
              <p className="text-xs text-gray-600">Поиск аномалий</p>
            </div>
            <div className="bg-white/80 rounded-lg p-3 border">
              <i className="fas fa-table text-pink-500 text-lg mb-1"></i>
              <p className="text-xs text-gray-600">Сводка</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-100 rounded-lg flex items-center justify-center">
              <i className="fas fa-file-csv text-indigo-600"></i>
            </div>
            <div>
              <h1 className="font-bold text-gray-800 text-lg leading-tight">Сводка по CSV</h1>
              <p className="text-xs text-gray-500">{fileName}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition">
              <i className="fas fa-upload mr-1"></i>Загрузить другой
              <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
            </label>
            <button
              onClick={() => setData(null)}
              className="text-gray-400 hover:text-red-500 transition p-2"
              title="Закрыть"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-4 pt-6">
        <div className="flex gap-1 bg-white rounded-xl p-1 shadow-sm border border-gray-100 w-fit">
          {[
            { id: 'overview' as const, label: 'Обзор', icon: 'fa-table' },
            { id: 'charts' as const, label: 'Графики', icon: 'fa-chart-line' },
            { id: 'suspicious' as const, label: `Подозрительные (${suspiciousRows.length})`, icon: 'fa-exclamation-triangle' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 ${
                activeTab === tab.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <i className={`fas ${tab.icon}`}></i>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatsCard title="Всего строк" value={data.rows.length} icon="fa-list-ol" color="bg-indigo-500" />
              <StatsCard title="Столбцов" value={data.headers.length} icon="fa-columns" color="bg-purple-500" />
              <StatsCard title="Числовых" value={numericStats.length} icon="fa-calculator" color="bg-blue-500" />
              <StatsCard title="Пропусков" value={totalMissing} icon="fa-exclamation-circle" color="bg-red-500" />
            </div>

            {/* Column stats table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                  <i className="fas fa-info-circle text-indigo-500"></i>
                  Статистика по столбцам
                </h3>
              </div>
              <ColumnStatsTable stats={columnStats} />
            </div>

            {/* Missing values chart */}
            <MissingValuesChart stats={columnStats} />

            {/* Data preview */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                  <i className="fas fa-eye text-indigo-500"></i>
                  Предпросмотр данных (первые 10 строк)
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left p-3 text-gray-500 font-medium">#</th>
                      {data.headers.map(h => (
                        <th key={h} className="text-left p-3 text-gray-500 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.slice(0, 10).map((row, i) => (
                      <tr key={i} className="border-t border-gray-50 hover:bg-gray-50/50">
                        <td className="p-3 text-gray-400">{i + 1}</td>
                        {data.headers.map(h => (
                          <td key={h} className={`p-3 whitespace-nowrap ${!row[h] ? 'bg-red-50 text-red-400 italic' : 'text-gray-700'}`}>
                            {row[h] || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* CHARTS TAB */}
        {activeTab === 'charts' && (
          <div className="space-y-6">
            {/* Numeric column selector */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <i className="fas fa-sliders-h text-indigo-500"></i>
                Настройки графиков
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">Столбец для распределения</label>
                  <select
                    value={selectedNumericX}
                    onChange={(e) => setSelectedNumericX(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                  >
                    {numericStats.map(s => (
                      <option key={s.name} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">Ось X (корреляция)</label>
                  <select
                    value={selectedNumericX}
                    onChange={(e) => setSelectedNumericX(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                  >
                    {numericStats.map(s => (
                      <option key={s.name} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">Ось Y (корреляция)</label>
                  <select
                    value={selectedNumericY}
                    onChange={(e) => setSelectedNumericY(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                  >
                    {numericStats.map(s => (
                      <option key={s.name} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Distribution chart */}
            {distributionData.length > 0 && (
              <DistributionChart data={distributionData} colName={selectedNumericX} />
            )}

            {/* Scatter plot */}
            {selectedNumericX && selectedNumericY && (
              <ScatterPlot rows={data.rows} xCol={selectedNumericX} yCol={selectedNumericY} />
            )}

            {/* Category pie charts */}
            {textStats.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {textStats.slice(0, 4).map(stat => (
                  stat.topValues && (
                    <CategoryPieChart
                      key={stat.name}
                      data={stat.topValues.map(t => ({ name: t.value, value: t.count }))}
                      title={stat.name}
                    />
                  )
                ))}
              </div>
            )}

            {/* Line chart for numeric data */}
            {numericStats.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <h4 className="font-semibold text-gray-700 mb-3">Тренд числовых данных</h4>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={data.rows.slice(0, 50).map((r, i) => {
                    const point: Record<string, string | number> = { index: i + 1 };
                    numericStats.forEach(s => {
                      if (r[s.name] && isNumeric(r[s.name])) {
                        point[s.name] = Number(r[s.name]);
                      }
                    });
                    return point;
                  })}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="index" tick={{ fontSize: 11 }} label={{ value: 'Строка', position: 'bottom', offset: -5 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    {numericStats.slice(0, 4).map((s, i) => (
                      <Line
                        key={s.name}
                        type="monotone"
                        dataKey={s.name}
                        stroke={COLORS[i % COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* SUSPICIOUS TAB */}
        {activeTab === 'suspicious' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h3 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                <i className="fas fa-shield-alt text-indigo-500"></i>
                Поиск подозрительных строк
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                Алгоритм проверяет: пропуски в данных, статистические выбросы (за 2σ), отрицательные значения,
                нереалистичные данные (возраст), дубликаты строк.
              </p>
              <SuspiciousRowsTable rows={suspiciousRows} headers={data.headers} />
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-8 py-4">
        <div className="max-w-7xl mx-auto px-4 text-center text-sm text-gray-400">
          <i className="fas fa-chart-pie mr-1"></i>
          Сводка по CSV — Анализ данных прямо в браузере
        </div>
      </footer>
    </div>
  );
}
