import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, AreaChart, Area
} from 'recharts'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Report {
  id: string
  client_id: string | null
  client_name: string | null
  file_name: string
  date_range_start: string | null
  date_range_end: string | null
  conversion_label: string
  secondary_label: string | null
  overall_health: string
  executive_summary: string
  funnel_insight: string | null
  action_plan: { immediate: string[]; this_week: string[]; next_week: string[] }
  budget_reallocation: string | null
  next_test: string
  total_spend: number
  total_conversions: number
  total_revenue: number | null
  has_revenue: boolean
  kpi_targets: Record<string, number>
  data_quality: Record<string, boolean | string | number | null>
}

interface PeriodAnalysis {
  id: string
  report_id: string
  period: string
  status: string
  executive_summary: string | null
  overall_health: string | null
  kpi_breakdown: KpiSummary[] | null
  campaigns: { campaign_name: string; verdict: string; confidence: number; primary_issue: string | null; recommendation: string }[] | null
  funnel_insight: string | null
  action_plan: { immediate: string[]; this_week: string[]; next_week: string[] } | null
  budget_reallocation: string | null
  next_test: string | null
}

interface KpiSummary {
  metric: string
  value: number
  target: number
  status: string
  note: string
}

interface Campaign {
  campaign_name: string
  spend: number
  impressions: number
  link_clicks: number
  conversions: number
  secondary_events: number | null
  roas: number | null
  cpa: number | null
  ctr: number | null
  conversion_rate: number | null
  cpm: number | null
  frequency: number | null
  objective: string | null
  performance_goal: string | null
  verdict: string
  confidence: number
  primary_issue: string | null
  recommendation: string
}

interface DailyRow {
  date: string
  campaign_name: string
  spend: number
  impressions: number
  link_clicks: number
  conversions: number
  secondary_events: number | null
  roas: number | null
  cpa: number | null
  ctr: number | null
  conversion_rate: number | null
  cpm: number | null
  frequency: number | null
  objective: string | null
  performance_goal: string | null
}

// ─── Utils ───────────────────────────────────────────────────────────────────

const hc = (h: string) => h === 'STRONG' ? '#16a34a' : h === 'STABLE' ? '#2563eb' : h === 'AT_RISK' ? '#d97706' : '#dc2626'
const hbg = (h: string) => h === 'STRONG' ? '#f0fdf4' : h === 'STABLE' ? '#eff6ff' : h === 'AT_RISK' ? '#fffbeb' : '#fef2f2'
const sc = (s: string) => s === 'ON_TRACK' ? '#16a34a' : s === 'AT_RISK' ? '#d97706' : '#dc2626'
const vc = (v: string) => v === 'SCALE' ? '#16a34a' : v === 'MAINTAIN' ? '#2563eb' : v === 'OPTIMIZE' ? '#d97706' : '#dc2626'
const vbg = (v: string) => v === 'SCALE' ? '#f0fdf4' : v === 'MAINTAIN' ? '#eff6ff' : v === 'OPTIMIZE' ? '#fffbeb' : '#fef2f2'
const fmtM = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n.toFixed(0)}`
const fmtSpend = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const fmt = (n: number | null, pre = '', suf = '', d = 2) => n == null ? '—' : `${pre}${Number(n).toFixed(d)}${suf}`
const splitBullets = (text: string) => text ? text.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(s => s.trim().length > 10) : []

// Normalise KPI metric names — strips "blended" and "account" prefixes,
// handles: "Account CPA", "Blended ROAS", "CPA", "Conversion Rate", etc.
const normaliseMetric = (m: string): string => {
  const s = m.toLowerCase().replace(/\b(blended|account)\s*/g, '').trim()
  if (s === 'cpa') return 'cpa'
  if (s === 'roas') return 'roas'
  if (s === 'ctr') return 'ctr'
  if (s.includes('conversion rate') || s === 'cr') return 'conversion_rate'
  if (s === 'frequency') return 'frequency'
  return s
}

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px 16px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', fontSize: '12px' }}>
      <div style={{ fontWeight: '700', marginBottom: '8px', color: '#111827', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #f3f4f6', paddingBottom: '6px' }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '20px', marginBottom: '3px' }}>
          <span style={{ color: p.color, fontWeight: '500' }}>{p.name}</span>
          <strong style={{ color: '#111827' }}>{typeof p.value === 'number' ? p.value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : p.value}</strong>
        </div>
      ))}
    </div>
  )
}

// ─── W/W Trend Component ─────────────────────────────────────────────────────

const WoWBadge = ({ current, previous, inverse = false }: { current: number; previous: number; inverse?: boolean }) => {
  if (!previous || previous === 0) return null
  const pct = ((current - previous) / previous) * 100
  const isUp = pct > 0
  const isGood = inverse ? !isUp : isUp
  const color = isGood ? '#16a34a' : '#dc2626'
  const bg = isGood ? '#f0fdf4' : '#fef2f2'
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '3px 8px', borderRadius: '6px', background: bg, marginTop: '8px' }}>
      <span style={{ fontSize: '11px', color }}>{isUp ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}% W/W</span>
    </div>
  )
}

// ─── Date Filter Dropdown ─────────────────────────────────────────────────────

const DateFilterDropdown = ({
  dateFrom, dateTo, reportStart, reportEnd,
  onFromChange, onToChange, onPreset, onClear
}: {
  dateFrom: string; dateTo: string; reportStart: string; reportEnd: string
  onFromChange: (v: string) => void; onToChange: (v: string) => void
  onPreset: (days: number) => void; onClear: () => void
}) => {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const isFiltered = dateFrom !== reportStart || dateTo !== reportEnd

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} style={{
        display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px',
        borderRadius: '8px', border: `1px solid ${isFiltered ? '#2563eb' : '#e8eaed'}`,
        background: isFiltered ? '#eff6ff' : '#fff', fontSize: '12px', fontWeight: '600',
        color: isFiltered ? '#2563eb' : '#374151', cursor: 'pointer'
      }}>
        📅 {isFiltered ? `${dateFrom} → ${dateTo}` : 'Date range'}
        {isFiltered && <span onClick={e => { e.stopPropagation(); onClear() }} style={{ marginLeft: '4px', color: '#2563eb', fontWeight: '700' }}>✕</span>}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '38px', left: 0, background: '#fff',
          borderRadius: '12px', border: '1px solid #e8eaed', boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
          padding: '16px', zIndex: 100, width: '280px'
        }}>
          <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: '#9ca3af', marginBottom: '10px' }}>Quick Select</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginBottom: '14px' }}>
            {[
              { label: 'Yesterday', days: 1 },
              { label: 'Last 3 days', days: 3 },
              { label: 'Last 7 days', days: 7 },
              { label: 'Last 14 days', days: 14 },
              { label: 'Last 30 days', days: 30 },
            ].map(({ label, days }) => (
              <button key={days} onClick={() => { onPreset(days); setOpen(false) }} style={{
                padding: '6px 8px', borderRadius: '7px', border: '1px solid #e8eaed',
                background: '#f9fafb', fontSize: '11px', fontWeight: '500', color: '#374151',
                cursor: 'pointer', textAlign: 'center'
              }}>{label}</button>
            ))}
            <button onClick={() => { onClear(); setOpen(false) }} style={{
              padding: '6px 8px', borderRadius: '7px', border: '1px solid #fecaca',
              background: '#fef2f2', fontSize: '11px', fontWeight: '600', color: '#dc2626',
              cursor: 'pointer', textAlign: 'center'
            }}>Clear</button>
          </div>
          <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: '#9ca3af', marginBottom: '8px' }}>Custom Range</div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input type="date" value={dateFrom} onChange={e => onFromChange(e.target.value)}
              style={{ flex: 1, padding: '6px 8px', borderRadius: '7px', border: '1px solid #e8eaed', fontSize: '11px', outline: 'none' }} />
            <span style={{ fontSize: '11px', color: '#d1d5db' }}>→</span>
            <input type="date" value={dateTo} onChange={e => onToChange(e.target.value)}
              style={{ flex: 1, padding: '6px 8px', borderRadius: '7px', border: '1px solid #e8eaed', fontSize: '11px', outline: 'none' }} />
          </div>
          <button onClick={() => setOpen(false)} style={{ width: '100%', marginTop: '12px', padding: '8px', borderRadius: '8px', border: 'none', background: '#2563eb', color: '#fff', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
            Apply
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ReportPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [report, setReport] = useState<Report | null>(null)
  const [kpis, setKpis] = useState<KpiSummary[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [dailyData, setDailyData] = useState<DailyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeSection, setActiveSection] = useState('summary')
  const [spendView, setSpendView] = useState<'weekly' | 'daily'>('weekly')
  const [convView, setConvView] = useState<'weekly' | 'daily'>('weekly')
  const [ctrView, setCtrView] = useState<'weekly' | 'daily'>('weekly')
  const [cpmView, setCpmView] = useState<'weekly' | 'daily'>('weekly')
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [periodAnalyses, setPeriodAnalyses] = useState<Record<string, PeriodAnalysis>>({})
  const [showConfTooltip, setShowConfTooltip] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [filterObjective, setFilterObjective] = useState('')
  const [filterGoal, setFilterGoal] = useState('')
  const [filterVerdict, setFilterVerdict] = useState('')
  const [filterName, setFilterName] = useState('')
  const [sortKey, setSortKey] = useState<keyof Campaign>('spend')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  // selectedCampaigns = staging (checkboxes); activeCampaignFilter = confirmed scope
  const [selectedCampaigns, setSelectedCampaigns] = useState<Set<string>>(new Set())
  const [activeCampaignFilter, setActiveCampaignFilter] = useState<Set<string>>(new Set())
  const HEADER_OFFSET = 112
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const sectionRefs = {
    summary: useRef<HTMLDivElement>(null),
    kpis: useRef<HTMLDivElement>(null),
    charts: useRef<HTMLDivElement>(null),
    campaigns: useRef<HTMLDivElement>(null),
    actions: useRef<HTMLDivElement>(null),
  }

  // ─── Initial load ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return
    const load = async () => {
      try {
        const [{ data: r }, { data: k }, { data: c }, { data: d }, { data: pa }] = await Promise.all([
          supabase.from('reports').select('*').eq('id', id).single(),
          supabase.from('kpi_summary').select('*').eq('report_id', id),
          supabase.from('campaigns').select('*').eq('report_id', id).order('spend', { ascending: false }),
          supabase.from('daily_data').select('*').eq('report_id', id).order('date', { ascending: true }),
          supabase.from('report_analyses').select('*').eq('report_id', id),
        ])
        if (!r) { setError('Report not found.'); return }
        setReport(r); setKpis(k || []); setCampaigns(c || []); setDailyData(d || [])
        setDateFrom(r.date_range_start || ''); setDateTo(r.date_range_end || '')
        const paMap: Record<string, PeriodAnalysis> = {}
        for (const row of (pa || [])) { paMap[row.period] = row }
        setPeriodAnalyses(paMap)
      } catch { setError('Failed to load report.') }
      finally { setLoading(false) }
    }
    load()
  }, [id])

  // ─── Polling for period analyses ─────────────────────────────────────────
  // Polls every 10s after initial load. Stops when both 7d and 30d are ready,
  // or after 5 minutes (30 ticks).

  useEffect(() => {
    if (!id || loading) return
    let ticks = 0
    const check = async () => {
      ticks++
      const { data: pa } = await supabase
        .from('report_analyses')
        .select('*')
        .eq('report_id', id)
      if (!pa) return
      const paMap: Record<string, PeriodAnalysis> = {}
      for (const row of pa) { paMap[row.period] = row }
      setPeriodAnalyses(paMap)
      const both7dReady = paMap['7d']?.status === 'ready'
      const both30dReady = paMap['30d']?.status === 'ready'
      if ((both7dReady && both30dReady) || ticks >= 30) {
        if (pollingRef.current) clearInterval(pollingRef.current)
      }
    }
    pollingRef.current = setInterval(check, 10000)
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [id, loading])

  const scrollTo = (key: string) => {
    setActiveSection(key)
    const el = sectionRefs[key as keyof typeof sectionRefs]?.current
    if (!el) return
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET, behavior: 'smooth' })
  }

  const applyPreset = (days: number) => {
    if (!report?.date_range_end) return
    const end = new Date(report.date_range_end)
    const from = new Date(end)
    from.setDate(end.getDate() - days + 1)
    setDateFrom(from.toISOString().split('T')[0])
    setDateTo(report.date_range_end)
  }

  const clearDates = () => {
    setDateFrom(report?.date_range_start || '')
    setDateTo(report?.date_range_end || '')
  }

  // ─── W/W calculation ─────────────────────────────────────────────────────

  const wowStats = useMemo(() => {
    if (!dailyData.length) return null
    const allDates = [...new Set(dailyData.map(d => d.date))].sort()
    if (allDates.length < 14) return null
    const lastWeekDates = new Set(allDates.slice(-7))
    const prevWeekDates = new Set(allDates.slice(-14, -7))
    const sum = (dates: Set<string>) => dailyData
      .filter(d => dates.has(d.date))
      .reduce((a, d) => ({
        spend: a.spend + Number(d.spend),
        conversions: a.conversions + Number(d.conversions),
        revenue: a.revenue + (d.roas != null ? Number(d.roas) * Number(d.spend) : 0)
      }), { spend: 0, conversions: 0, revenue: 0 })
    return { last: sum(lastWeekDates), prev: sum(prevWeekDates) }
  }, [dailyData])

  // ─── Filtered daily (date + objective + goal only) ────────────────────────

  const filteredDaily = useMemo(() => dailyData.filter(d => {
    if (dateFrom && d.date < dateFrom) return false
    if (dateTo && d.date > dateTo) return false
    if (filterObjective && d.objective !== filterObjective) return false
    if (filterGoal && d.performance_goal !== filterGoal) return false
    return true
  }), [dailyData, dateFrom, dateTo, filterObjective, filterGoal])

  // ─── Scoped daily (applies activeCampaignFilter on top) ──────────────────

  const scopedDaily = useMemo(() => {
    if (activeCampaignFilter.size === 0) return filteredDaily
    return filteredDaily.filter(d => activeCampaignFilter.has(d.campaign_name))
  }, [filteredDaily, activeCampaignFilter])

  // ─── Recalc campaigns from filteredDaily ────────────────────────────────

  const recalcCampaigns = useMemo(() => {
    const byName: Record<string, { spend: number; impressions: number; link_clicks: number; conversions: number; secondary_events: number; revenue: number }> = {}
    filteredDaily.forEach(d => {
      if (!byName[d.campaign_name]) byName[d.campaign_name] = { spend: 0, impressions: 0, link_clicks: 0, conversions: 0, secondary_events: 0, revenue: 0 }
      byName[d.campaign_name].spend += Number(d.spend)
      byName[d.campaign_name].impressions += Number(d.impressions)
      byName[d.campaign_name].link_clicks += Number(d.link_clicks)
      byName[d.campaign_name].conversions += Number(d.conversions)
      byName[d.campaign_name].secondary_events += Number(d.secondary_events || 0)
      byName[d.campaign_name].revenue += d.roas != null ? Number(d.roas) * Number(d.spend) : 0
    })
    return campaigns.filter(c => byName[c.campaign_name]).map(c => {
      const r = byName[c.campaign_name]
      return {
        ...c, spend: r.spend, impressions: r.impressions, link_clicks: r.link_clicks, conversions: r.conversions,
        roas: report?.has_revenue && r.spend > 0 ? r.revenue / r.spend : null,
        cpa: r.conversions > 0 ? r.spend / r.conversions : null,
        ctr: r.impressions > 0 ? r.link_clicks / r.impressions * 100 : null,
        conversion_rate: r.link_clicks > 0 ? r.conversions / r.link_clicks * 100 : null,
        cpm: r.impressions > 0 ? r.spend / r.impressions * 1000 : null,
      }
    })
  }, [campaigns, filteredDaily, report])

  // filteredCampaigns = after text search + verdict + activeCampaignFilter
  const filteredCampaigns = useMemo(() => recalcCampaigns
    .filter(c => {
      if (activeCampaignFilter.size > 0 && !activeCampaignFilter.has(c.campaign_name)) return false
      if (filterVerdict && c.verdict !== filterVerdict) return false
      if (filterName && !c.campaign_name.toLowerCase().includes(filterName.toLowerCase())) return false
      return true
    })
    .sort((a, b) => {
      const av = (a[sortKey] as number) ?? -Infinity
      const bv = (b[sortKey] as number) ?? -Infinity
      return sortDir === 'desc' ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1)
    }), [recalcCampaigns, activeCampaignFilter, filterVerdict, filterName, sortKey, sortDir])

  // ─── Chart data (uses scopedDaily) ───────────────────────────────────────

  const spendData = useMemo(() => {
    if (spendView === 'daily') {
      const m: Record<string, number> = {}
      scopedDaily.forEach(d => { m[d.date] = (m[d.date] || 0) + Number(d.spend) })
      return Object.entries(m).map(([date, spend]) => ({ date, spend: Math.round(spend) }))
    }
    const m: Record<string, number> = {}
    scopedDaily.forEach(d => {
      const dt = new Date(d.date), day = dt.getDay()
      const mon = new Date(dt); mon.setDate(dt.getDate() - (day === 0 ? 6 : day - 1))
      const k = mon.toISOString().split('T')[0]
      m[k] = (m[k] || 0) + Number(d.spend)
    })
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([date, spend]) => ({ date, spend: Math.round(spend) }))
  }, [scopedDaily, spendView])

  const convCpaData = useMemo(() => {
    const bucket = (d: DailyRow) => {
      if (convView === 'daily') return d.date
      const dt = new Date(d.date), day = dt.getDay()
      const mon = new Date(dt); mon.setDate(dt.getDate() - (day === 0 ? 6 : day - 1))
      return mon.toISOString().split('T')[0]
    }
    const m: Record<string, { conv: number; spend: number }> = {}
    scopedDaily.forEach(d => {
      const k = bucket(d)
      if (!m[k]) m[k] = { conv: 0, spend: 0 }
      m[k].conv += Number(d.conversions); m[k].spend += Number(d.spend)
    })
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, conversions: v.conv, cpa: v.conv > 0 ? Math.round(v.spend / v.conv) : null }))
  }, [scopedDaily, convView])

  const ctrCrData = useMemo(() => {
    const bucket = (d: DailyRow) => {
      if (ctrView === 'daily') return d.date
      const dt = new Date(d.date), day = dt.getDay()
      const mon = new Date(dt); mon.setDate(dt.getDate() - (day === 0 ? 6 : day - 1))
      return mon.toISOString().split('T')[0]
    }
    const m: Record<string, { imp: number; clicks: number; conv: number }> = {}
    scopedDaily.forEach(d => {
      const k = bucket(d)
      if (!m[k]) m[k] = { imp: 0, clicks: 0, conv: 0 }
      m[k].imp += Number(d.impressions); m[k].clicks += Number(d.link_clicks); m[k].conv += Number(d.conversions)
    })
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({
      date,
      ctr: v.imp > 0 ? Number((v.clicks / v.imp * 100).toFixed(3)) : null,
      cr: v.clicks > 0 ? Number((v.conv / v.clicks * 100).toFixed(3)) : null,
    }))
  }, [scopedDaily, ctrView])

  const cpmRoasData = useMemo(() => {
    const bucket = (d: DailyRow) => {
      if (cpmView === 'daily') return d.date
      const dt = new Date(d.date), day = dt.getDay()
      const mon = new Date(dt); mon.setDate(dt.getDate() - (day === 0 ? 6 : day - 1))
      return mon.toISOString().split('T')[0]
    }
    const m: Record<string, { imp: number; spend: number; rev: number }> = {}
    scopedDaily.forEach(d => {
      const k = bucket(d)
      if (!m[k]) m[k] = { imp: 0, spend: 0, rev: 0 }
      m[k].imp += Number(d.impressions); m[k].spend += Number(d.spend)
      m[k].rev += d.roas != null ? Number(d.roas) * Number(d.spend) : 0
    })
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({
      date,
      cpm: v.imp > 0 ? Number((v.spend / v.imp * 1000).toFixed(2)) : null,
      roas_pct: report?.has_revenue && v.spend > 0 ? Math.round(v.rev / v.spend * 100) : null,
    }))
  }, [scopedDaily, cpmView, report])

  // ─── KPI boxes (scopedDaily + normalised metric lookup) ──────────────────

  const filteredKpis = useMemo(() => {
    if (!scopedDaily.length) return kpis
    const totals = scopedDaily.reduce((a, d) => ({
      spend: a.spend + Number(d.spend),
      impressions: a.impressions + Number(d.impressions),
      link_clicks: a.link_clicks + Number(d.link_clicks),
      conversions: a.conversions + Number(d.conversions),
      revenue: a.revenue + (d.roas != null ? Number(d.roas) * Number(d.spend) : 0),
      frequency_sum: a.frequency_sum + Number((d as any).frequency || 0),
      frequency_count: a.frequency_count + (Number((d as any).frequency || 0) > 0 ? 1 : 0),
    }), { spend: 0, impressions: 0, link_clicks: 0, conversions: 0, revenue: 0, frequency_sum: 0, frequency_count: 0 })
    const computed: Record<string, number> = {
      cpa: totals.conversions > 0 ? totals.spend / totals.conversions : 0,
      ctr: totals.impressions > 0 ? (totals.link_clicks / totals.impressions) * 100 : 0,
      conversion_rate: totals.link_clicks > 0 ? (totals.conversions / totals.link_clicks) * 100 : 0,
      frequency: totals.frequency_count > 0 ? totals.frequency_sum / totals.frequency_count : 0,
    }
    if (report?.has_revenue) {
      computed.roas = totals.spend > 0 ? (totals.revenue / totals.spend) * 100 : 0
    }
    return kpis.map(k => {
      const key = normaliseMetric(k.metric)
      if (key === 'roas' && !report?.has_revenue) return k
      const val = computed[key]
      if (val === undefined) return k
      const isInverse = key === 'cpa' || key === 'frequency'
      const status = isInverse
        ? val <= k.target ? 'ON_TRACK' : val <= k.target * 1.2 ? 'AT_RISK' : 'UNDERPERFORMING'
        : val >= k.target ? 'ON_TRACK' : val >= k.target * 0.8 ? 'AT_RISK' : 'UNDERPERFORMING'
      return { ...k, value: val, status }
    })
  }, [kpis, scopedDaily, report])

  const objectives = useMemo(() => [...new Set(dailyData.map(d => d.objective).filter(Boolean))] as string[], [dailyData])
  const goals = useMemo(() => [...new Set(dailyData.map(d => d.performance_goal).filter(Boolean))] as string[], [dailyData])

  const activePeriod = useMemo(() => {
    if (!report?.date_range_end || !dateFrom) return 'full'
    const [ey, em, ed] = report.date_range_end.split('-').map(Number)
    const endMs = Date.UTC(ey, em - 1, ed)
    const c7d = new Date(endMs - 6 * 86400000)
    const cutoff7d = `${c7d.getUTCFullYear()}-${String(c7d.getUTCMonth()+1).padStart(2,'0')}-${String(c7d.getUTCDate()).padStart(2,'0')}`
    const c30d = new Date(endMs - 29 * 86400000)
    const cutoff30d = `${c30d.getUTCFullYear()}-${String(c30d.getUTCMonth()+1).padStart(2,'0')}-${String(c30d.getUTCDate()).padStart(2,'0')}`
    if (dateFrom === cutoff7d && dateTo === report.date_range_end) return '7d'
    if (dateFrom === cutoff30d && dateTo === report.date_range_end) return '30d'
    return 'full'
  }, [dateFrom, dateTo, report])

  const activeAnalysis = useMemo(() => {
    if (activePeriod === 'full') return null
    const pa = periodAnalyses[activePeriod]
    if (!pa || pa.status !== 'ready') return null
    return pa
  }, [activePeriod, periodAnalyses])

  const isPeriodPending = useMemo(() => {
    if (activePeriod === 'full') return false
    const pa = periodAnalyses[activePeriod]
    return !pa || pa.status === 'pending'
  }, [activePeriod, periodAnalyses])

  const displayKpis = useMemo(() => {
    if (!activeAnalysis?.kpi_breakdown) return filteredKpis
    const noteMap: Record<string, string> = {}
    for (const k of activeAnalysis.kpi_breakdown) noteMap[normaliseMetric(k.metric)] = k.note
    return filteredKpis.map(k => ({ ...k, note: noteMap[normaliseMetric(k.metric)] ?? k.note }))
  }, [activeAnalysis, filteredKpis])

  const isDateFiltered = report && (dateFrom !== report.date_range_start || dateTo !== report.date_range_end)

  const displayCampaigns = useMemo(() => {
    if (!activeAnalysis?.campaigns) return filteredCampaigns
    return filteredCampaigns.map(c => {
      const pa = activeAnalysis.campaigns!.find(p => p.campaign_name === c.campaign_name)
      if (!pa) return c
      return { ...c, verdict: pa.verdict, confidence: pa.confidence, primary_issue: pa.primary_issue, recommendation: pa.recommendation }
    })
  }, [filteredCampaigns, activeAnalysis])

  // ─── Subtotal row — always reflects displayCampaigns ─────────────────────

  const subtotal = useMemo(() => {
    if (!displayCampaigns.length) return null
    const t = displayCampaigns.reduce((a, c) => ({
      spend: a.spend + Number(c.spend),
      impressions: a.impressions + Number(c.impressions),
      link_clicks: a.link_clicks + Number(c.link_clicks),
      conversions: a.conversions + Number(c.conversions),
      revenue: a.revenue + (c.roas != null ? Number(c.roas) * Number(c.spend) : 0),
    }), { spend: 0, impressions: 0, link_clicks: 0, conversions: 0, revenue: 0 })
    return {
      spend: t.spend,
      conversions: t.conversions,
      cpa: t.conversions > 0 ? t.spend / t.conversions : null,
      roas: report?.has_revenue && t.spend > 0 ? t.revenue / t.spend : null,
      ctr: t.impressions > 0 ? t.link_clicks / t.impressions * 100 : null,
      conversion_rate: t.link_clicks > 0 ? t.conversions / t.link_clicks * 100 : null,
      cpm: t.impressions > 0 ? t.spend / t.impressions * 1000 : null,
    }
  }, [displayCampaigns, report])

  const hasFilters = !!(filterObjective || filterGoal || filterVerdict || filterName || isDateFiltered)
  const hasCampaignFilter = activeCampaignFilter.size > 0
  const hasPendingSelection = selectedCampaigns.size > 0

  // ─── Campaign selection helpers ───────────────────────────────────────────

  const visibleCampaignNames = useMemo(() => filteredCampaigns.map(c => c.campaign_name), [filteredCampaigns])
  const allVisibleSelected = visibleCampaignNames.length > 0 && visibleCampaignNames.every(n => selectedCampaigns.has(n))
  const someVisibleSelected = visibleCampaignNames.some(n => selectedCampaigns.has(n))

  const toggleCampaign = (name: string) => {
    setSelectedCampaigns(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedCampaigns(prev => {
        const next = new Set(prev)
        visibleCampaignNames.forEach(n => next.delete(n))
        return next
      })
    } else {
      setSelectedCampaigns(prev => {
        const next = new Set(prev)
        visibleCampaignNames.forEach(n => next.add(n))
        return next
      })
    }
  }

  const applySelection = () => {
    setActiveCampaignFilter(new Set(selectedCampaigns))
  }

  const clearCampaignFilter = () => {
    setActiveCampaignFilter(new Set())
    setSelectedCampaigns(new Set())
  }

  const handleDelete = async () => {
    if (!id) return
    const { error: err } = await supabase.from('reports').delete().eq('id', id)
    if (!err) navigate('/history')
    else { alert('Delete failed — check Supabase RLS policies allow delete.'); console.error(err) }
  }

  // ─── Styles ───────────────────────────────────────────────────────────────

  const card = { background: '#fff', borderRadius: '14px', border: '1px solid #f1f1f4', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }
  const secLabel: React.CSSProperties = { fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#9ca3af', marginBottom: '14px', display: 'block' }
  const navBtn = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px',
    borderRadius: '9px', cursor: 'pointer', fontSize: '13px', fontWeight: 500,
    background: active ? '#f0f5ff' : 'transparent', color: active ? '#2563eb' : '#64748b',
    border: 'none', width: '100%', textAlign: 'left', transition: 'all 0.15s',
  })
  const filterInput: React.CSSProperties = {
    padding: '6px 11px', borderRadius: '8px', border: '1px solid #e8eaed',
    fontSize: '12px', color: '#374151', outline: 'none', background: '#fff', fontFamily: 'inherit',
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#f7f8fa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
        <div style={{ width: '32px', height: '32px', border: '3px solid #e5e7eb', borderTop: '3px solid #2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <div style={{ fontSize: '13px', color: '#9ca3af' }}>Loading report...</div>
      </div>
    </div>
  )

  if (error || !report) return (
    <div style={{ minHeight: '100vh', background: '#f7f8fa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: '14px', color: '#dc2626' }}>{error || 'Report not found.'}</div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#f7f8fa', fontFamily: "'Inter', -apple-system, sans-serif" }}>

      {/* ── Header ── */}
      <div style={{ background: '#fff', borderBottom: '1px solid #f1f1f4', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', position: 'sticky', top: 0, zIndex: 30 }}>
        <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '0 28px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '28px', height: '28px', background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#fff', fontSize: '13px', fontWeight: '800' }}>M</span>
            </div>
            <span style={{ fontWeight: '800', fontSize: '14px', color: '#111827', letterSpacing: '-0.3px', cursor: 'pointer' }} onClick={() => navigate('/')}>AI Media Buyer</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => navigate('/')} style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid #e8eaed', background: '#fff', fontSize: '12px', fontWeight: '600', color: '#374151', cursor: 'pointer' }}>+ New Analysis</button>
            <button onClick={() => navigate('/history')} style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid #e8eaed', background: '#fff', fontSize: '12px', fontWeight: '600', color: '#374151', cursor: 'pointer' }}>History</button>
          </div>
        </div>
      </div>

      {/* ── Filter Bar ── */}
      <div style={{ background: '#fff', borderBottom: '1px solid #f1f1f4', padding: '10px 28px', position: 'sticky', top: '56px', zIndex: 29 }}>
        <div style={{ maxWidth: '1440px', margin: '0 auto', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' as const }}>
          <DateFilterDropdown
            dateFrom={dateFrom} dateTo={dateTo}
            reportStart={report.date_range_start || ''} reportEnd={report.date_range_end || ''}
            onFromChange={setDateFrom} onToChange={setDateTo}
            onPreset={applyPreset} onClear={clearDates}
          />
          <div style={{ width: '1px', height: '18px', background: '#e8eaed' }} />
          <input placeholder="🔍 Search campaigns..." value={filterName} onChange={e => setFilterName(e.target.value)} style={{ ...filterInput, minWidth: '180px' }} />
          {objectives.length > 0 && (
            <select value={filterObjective} onChange={e => setFilterObjective(e.target.value)} style={{ ...filterInput, cursor: 'pointer' }}>
              <option value="">All Objectives</option>
              {objectives.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
          {goals.length > 0 && (
            <select value={filterGoal} onChange={e => setFilterGoal(e.target.value)} style={{ ...filterInput, cursor: 'pointer' }}>
              <option value="">All Goals</option>
              {goals.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          )}
          <select value={filterVerdict} onChange={e => setFilterVerdict(e.target.value)} style={{ ...filterInput, cursor: 'pointer' }}>
            <option value="">All Verdicts</option>
            {['SCALE', 'MAINTAIN', 'OPTIMIZE', 'PAUSE'].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          {(hasFilters || hasCampaignFilter) && (
            <button onClick={() => {
              setFilterObjective(''); setFilterGoal(''); setFilterVerdict(''); setFilterName('')
              clearDates(); clearCampaignFilter()
            }} style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #fca5a5', background: '#fef2f2', fontSize: '11px', fontWeight: '700', color: '#dc2626', cursor: 'pointer' }}>
              ✕ Clear all
            </button>
          )}
        </div>
      </div>

      {/* ── Status Banners ── */}
      {(hasFilters || hasCampaignFilter || activePeriod !== 'full') && (
        <>
          {(hasFilters || activePeriod !== 'full') && (
            <div style={{
              borderBottom: '1px solid',
              borderColor: activePeriod !== 'full' && !isPeriodPending ? '#bfdbfe' : '#fde68a',
              background: activePeriod !== 'full' && !isPeriodPending ? '#eff6ff' : '#fffbeb',
              padding: '8px 28px'
            }}>
              <div style={{ maxWidth: '1440px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px' }}>
                  {activePeriod !== 'full' && !isPeriodPending ? '🔵' : activePeriod !== 'full' && isPeriodPending ? '⏳' : '⚠️'}
                </span>
                <span style={{ fontSize: '12px', fontWeight: '500', color: activePeriod !== 'full' && !isPeriodPending ? '#1e40af' : '#92400e' }}>
                  {activePeriod !== 'full' && !isPeriodPending
                    ? `Showing ${activePeriod === '7d' ? '7-day' : '30-day'} AI insights.${hasFilters ? ' Additional filters affect charts and metrics only.' : ' Charts and campaign metrics reflect your date filter.'}`
                    : activePeriod !== 'full' && isPeriodPending
                    ? `AI insights for this period are being prepared — showing full report insights for now.`
                    : 'Insights reflect the full report period. Charts and table reflect your active filters.'}
                </span>
              </div>
            </div>
          )}
          {hasCampaignFilter && (
            <div style={{ borderBottom: '1px solid #fed7aa', background: '#fff7ed', padding: '8px 28px' }}>
              <div style={{ maxWidth: '1440px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px' }}>🎯</span>
                <span style={{ fontSize: '12px', fontWeight: '500', color: '#9a3412' }}>
                  Charts and KPIs scoped to {activeCampaignFilter.size} selected campaign{activeCampaignFilter.size !== 1 ? 's' : ''}. AI insights are not affected.
                </span>
                <button onClick={clearCampaignFilter} style={{ marginLeft: 'auto', padding: '3px 10px', borderRadius: '6px', border: '1px solid #fdba74', background: '#fff', fontSize: '11px', fontWeight: '700', color: '#c2410c', cursor: 'pointer' }}>
                  Clear selection
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Body ── */}
      <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '24px 28px', display: 'flex', gap: '24px', alignItems: 'flex-start' }}>

        {/* ── Sidebar ── */}
        <div style={{ width: '216px', flexShrink: 0, position: 'sticky', top: `${HEADER_OFFSET + 8}px` }}>
          <div style={{ ...card, padding: '20px', marginBottom: '10px' }}>
            <div style={{ fontSize: '15px', fontWeight: '800', color: '#111827', letterSpacing: '-0.4px', marginBottom: '6px', lineHeight: 1.2 }}>
              {report.client_name || report.conversion_label}
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '20px', marginBottom: '8px', background: hbg(activeAnalysis?.overall_health ?? report.overall_health), border: `1px solid ${hc(activeAnalysis?.overall_health ?? report.overall_health)}25` }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: hc(activeAnalysis?.overall_health ?? report.overall_health) }} />
              <span style={{ fontSize: '11px', fontWeight: '700', color: hc(activeAnalysis?.overall_health ?? report.overall_health) }}>{activeAnalysis?.overall_health ?? report.overall_health}</span>
            </div>
            <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '20px', fontFamily: 'monospace' }}>
              {report.date_range_start} → {report.date_range_end}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
              {[
                { key: 'summary', label: 'Summary', icon: '▤' },
                { key: 'kpis', label: 'KPI Performance', icon: '◎' },
                { key: 'charts', label: 'Trends', icon: '◫' },
                { key: 'campaigns', label: 'Campaigns', icon: '◱' },
                { key: 'actions', label: 'Action Plan', icon: '◷' },
              ].map(({ key, label, icon }) => (
                <button key={key} style={navBtn(activeSection === key)} onClick={() => scrollTo(key)}>
                  <span style={{ fontSize: '13px', opacity: 0.5 }}>{icon}</span>{label}
                </button>
              ))}
            </div>
            <div style={{ height: '1px', background: '#f1f1f4', margin: '16px 0' }} />
            <div style={{ fontSize: '10px', color: '#cbd5e1', wordBreak: 'break-all', lineHeight: '1.5' }}>{report.file_name}</div>
          </div>
          {!deleteConfirm ? (
            <button onClick={() => setDeleteConfirm(true)} style={{ width: '100%', padding: '8px', borderRadius: '9px', border: '1px solid #fecaca', background: '#fff', fontSize: '12px', fontWeight: '500', color: '#ef4444', cursor: 'pointer' }}>
              Delete report
            </button>
          ) : (
            <div style={{ ...card, padding: '14px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#111827', marginBottom: '4px' }}>Delete this report?</div>
              <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '12px' }}>This cannot be undone.</div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={handleDelete} style={{ flex: 1, padding: '7px', borderRadius: '7px', border: 'none', background: '#ef4444', color: '#fff', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>Delete</button>
                <button onClick={() => setDeleteConfirm(false)} style={{ flex: 1, padding: '7px', borderRadius: '7px', border: '1px solid #e8eaed', background: '#fff', fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* ── Main ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* ── Summary ── */}
          <div ref={sectionRefs.summary}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '16px' }}>
              {[
                { label: 'Total Spend', value: fmtM(report.total_spend), wow: wowStats ? { current: wowStats.last.spend, previous: wowStats.prev.spend, inverse: false } : null },
                { label: 'Total Conversions', value: report.total_conversions.toLocaleString(), wow: wowStats ? { current: wowStats.last.conversions, previous: wowStats.prev.conversions, inverse: false } : null },
                ...(report.has_revenue ? [{ label: 'Total Revenue', value: fmtM(report.total_revenue ?? 0), wow: wowStats ? { current: wowStats.last.revenue, previous: wowStats.prev.revenue, inverse: false } : null }] : []),
              ].map(({ label, value, wow }) => (
                <div key={label} style={{ ...card, padding: '20px 24px' }}>
                  <div style={{ fontSize: '11px', color: '#9ca3af', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '10px' }}>{label}</div>
                  <div style={{ fontSize: '26px', fontWeight: '800', color: '#111827', letterSpacing: '-1px', fontFamily: "'SF Mono', monospace" }}>{value}</div>
                  {wow && <WoWBadge current={wow.current} previous={wow.previous} inverse={wow.inverse} />}
                </div>
              ))}
            </div>
            <div style={{ ...card, padding: '24px' }}>
              <span style={secLabel}>Executive Summary</span>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {splitBullets(activeAnalysis?.executive_summary ?? report.executive_summary).map((s, i) => (
                  <li key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#2563eb', marginTop: '8px', flexShrink: 0 }} />
                    <span style={{ fontSize: '13px', lineHeight: '1.75', color: '#374151' }}>{s.trim()}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* ── KPIs ── */}
          <div ref={sectionRefs.kpis}>
            <span style={secLabel}>KPI Performance</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '14px' }}>
              {displayKpis.map(kpi => (
                <div key={kpi.metric} style={{ ...card, padding: '20px' }}>
                  <div style={{ fontSize: '10px', color: '#9ca3af', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>{kpi.metric}</div>
                  <div style={{ fontSize: '30px', fontWeight: '800', color: sc(kpi.status), lineHeight: 1, letterSpacing: '-1.5px', fontFamily: "'SF Mono', monospace", marginBottom: '6px' }}>
                    {normaliseMetric(kpi.metric) === 'cpa' ? `$${Number(kpi.value).toFixed(2)}` :
                     normaliseMetric(kpi.metric) === 'roas' ? `${Number(kpi.value).toFixed(0)}%` :
                     normaliseMetric(kpi.metric) === 'frequency' ? Number(kpi.value).toFixed(2) :
                     `${Number(kpi.value).toFixed(2)}%`}
                  </div>
                  <div style={{ fontSize: '11px', color: '#d1d5db', marginBottom: '10px' }}>
                    Target: {normaliseMetric(kpi.metric) === 'cpa' ? `$${kpi.target}` : normaliseMetric(kpi.metric) === 'roas' ? `${kpi.target}%` : normaliseMetric(kpi.metric) === 'frequency' ? kpi.target : `${kpi.target}%`}
                  </div>
                  <div style={{ display: 'inline-flex', padding: '3px 9px', borderRadius: '5px', fontSize: '10px', fontWeight: '700', background: sc(kpi.status) + '12', color: sc(kpi.status), marginBottom: '10px' }}>
                    {kpi.status.replace('_', ' ')}
                  </div>
                  <div style={{ fontSize: '11px', color: '#6b7280', lineHeight: '1.6' }}>{kpi.note}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Charts ── */}
          {scopedDaily.length > 0 && (
            <div ref={sectionRefs.charts}>
              <span style={secLabel}>Performance Trends</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ ...card, padding: '22px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: '#374151' }}>Spend Trend</span>
                    <div style={{ display: 'flex', gap: '3px', background: '#f7f8fa', padding: '3px', borderRadius: '7px' }}>
                      {(['weekly', 'daily'] as const).map(v => (
                        <button key={v} onClick={() => setSpendView(v)} style={{ padding: '3px 10px', borderRadius: '5px', border: 'none', fontSize: '11px', fontWeight: '600', cursor: 'pointer', background: spendView === v ? '#fff' : 'transparent', color: spendView === v ? '#2563eb' : '#9ca3af', boxShadow: spendView === v ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>{v === 'weekly' ? 'Weekly' : 'Daily'}</button>
                      ))}
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={spendData}>
                      <defs>
                        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#2563eb" stopOpacity={0.1} />
                          <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f7f8fa" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#d1d5db' }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#d1d5db' }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
                      <Tooltip content={<ChartTooltip />} />
                      <Area type="monotone" dataKey="spend" stroke="#2563eb" strokeWidth={2.5} fill="url(#sg)" name="Spend ($)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                <div style={{ ...card, padding: '22px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: '#374151' }}>Conversions vs CPA</span>
                    <div style={{ display: 'flex', gap: '3px', background: '#f7f8fa', padding: '3px', borderRadius: '7px' }}>
                      {(['weekly', 'daily'] as const).map(v => (
                        <button key={v} onClick={() => setConvView(v)} style={{ padding: '3px 10px', borderRadius: '5px', border: 'none', fontSize: '11px', fontWeight: '600', cursor: 'pointer', background: convView === v ? '#fff' : 'transparent', color: convView === v ? '#2563eb' : '#9ca3af', boxShadow: convView === v ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>{v === 'weekly' ? 'Weekly' : 'Daily'}</button>
                      ))}
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    <ComposedChart data={convCpaData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f7f8fa" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#d1d5db' }} tickLine={false} axisLine={false} />
                      <YAxis yAxisId="l" tick={{ fontSize: 10, fill: '#d1d5db' }} tickLine={false} axisLine={false} />
                      <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10, fill: '#d1d5db' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: '11px', color: '#9ca3af' }} />
                      <Bar yAxisId="l" dataKey="conversions" fill="#2563eb" fillOpacity={0.5} name="Conversions" radius={[4, 4, 0, 0]} />
                      <Line yAxisId="r" type="monotone" dataKey="cpa" stroke="#ef4444" strokeWidth={2.5} dot={false} name="CPA ($)" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                <div style={{ ...card, padding: '22px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: '#374151' }}>CTR vs Conversion Rate</span>
                    <div style={{ display: 'flex', gap: '3px', background: '#f7f8fa', padding: '3px', borderRadius: '7px' }}>
                      {(['weekly', 'daily'] as const).map(v => (
                        <button key={v} onClick={() => setCtrView(v)} style={{ padding: '3px 10px', borderRadius: '5px', border: 'none', fontSize: '11px', fontWeight: '600', cursor: 'pointer', background: ctrView === v ? '#fff' : 'transparent', color: ctrView === v ? '#2563eb' : '#9ca3af', boxShadow: ctrView === v ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>{v === 'weekly' ? 'Weekly' : 'Daily'}</button>
                      ))}
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    <ComposedChart data={ctrCrData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f7f8fa" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#d1d5db' }} tickLine={false} axisLine={false} />
                      <YAxis yAxisId="ctr" tick={{ fontSize: 10, fill: '#2563eb' }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} width={36} />
                      <YAxis yAxisId="cr" orientation="right" tick={{ fontSize: 10, fill: '#16a34a' }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} width={36} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: '11px', color: '#9ca3af' }} />
                      <Line yAxisId="ctr" type="monotone" dataKey="ctr" stroke="#2563eb" strokeWidth={2.5} dot={false} name="CTR (%)" />
                      <Line yAxisId="cr" type="monotone" dataKey="cr" stroke="#16a34a" strokeWidth={2.5} dot={false} name="CR (%)" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                <div style={{ ...card, padding: '22px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: '#374151' }}>CPM{report.has_revenue ? ' vs ROAS %' : ''}</span>
                    <div style={{ display: 'flex', gap: '3px', background: '#f7f8fa', padding: '3px', borderRadius: '7px' }}>
                      {(['weekly', 'daily'] as const).map(v => (
                        <button key={v} onClick={() => setCpmView(v)} style={{ padding: '3px 10px', borderRadius: '5px', border: 'none', fontSize: '11px', fontWeight: '600', cursor: 'pointer', background: cpmView === v ? '#fff' : 'transparent', color: cpmView === v ? '#2563eb' : '#9ca3af', boxShadow: cpmView === v ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>{v === 'weekly' ? 'Weekly' : 'Daily'}</button>
                      ))}
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    <ComposedChart data={cpmRoasData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f7f8fa" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#d1d5db' }} tickLine={false} axisLine={false} />
                      <YAxis yAxisId="cpm" tick={{ fontSize: 10, fill: '#7c3aed' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} width={36} />
                      <YAxis yAxisId="roas" orientation="right" tick={{ fontSize: 10, fill: '#16a34a' }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} width={42} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: '11px', color: '#9ca3af' }} />
                      <Line yAxisId="cpm" type="monotone" dataKey="cpm" stroke="#7c3aed" strokeWidth={2.5} dot={false} name="CPM ($)" />
                      <Line yAxisId="roas" type="monotone" dataKey="roas_pct" stroke="#16a34a" strokeWidth={2.5} dot={false} name="ROAS (%)" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {(activeAnalysis?.funnel_insight ?? report.funnel_insight) && (
                <div style={{ ...card, padding: '20px', marginTop: '14px', borderLeft: '3px solid #2563eb' }}>
                  <span style={{ ...secLabel, color: '#2563eb' }}>Funnel Insight</span>
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {splitBullets(activeAnalysis?.funnel_insight ?? report.funnel_insight ?? '').map((s, i) => (
                      <li key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                        <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#2563eb', marginTop: '8px', flexShrink: 0 }} />
                        <span style={{ fontSize: '13px', lineHeight: '1.7', color: '#374151' }}>{s.trim()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ── Campaigns ── */}
          <div ref={sectionRefs.campaigns} style={{ ...card, overflow: 'hidden' }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #f7f8fa', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: '700', color: '#111827' }}>Campaigns</span>
                <span style={{ fontSize: '11px', fontWeight: '700', color: '#2563eb', background: '#eff6ff', padding: '2px 7px', borderRadius: '10px' }}>{displayCampaigns.length}</span>
                {hasCampaignFilter && (
                  <span style={{ fontSize: '11px', fontWeight: '700', color: '#c2410c', background: '#fff7ed', border: '1px solid #fed7aa', padding: '2px 7px', borderRadius: '10px' }}>
                    {activeCampaignFilter.size} filtered
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {/* Pending selection action button */}
                {hasPendingSelection && (
                  <button onClick={applySelection} style={{
                    padding: '5px 12px', borderRadius: '7px', border: 'none',
                    background: '#2563eb', color: '#fff', fontSize: '11px', fontWeight: '700', cursor: 'pointer'
                  }}>
                    Filter to {selectedCampaigns.size} selected
                  </button>
                )}
                {hasCampaignFilter && (
                  <button onClick={clearCampaignFilter} style={{ fontSize: '11px', fontWeight: '600', color: '#c2410c', background: 'none', border: 'none', cursor: 'pointer' }}>
                    Clear filter
                  </button>
                )}
                <span style={{ fontSize: '11px', color: '#9ca3af' }}>Click row to expand</span>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={{ padding: '11px 14px', width: '36px', borderBottom: '1px solid #f1f1f4' }}>
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        ref={el => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected }}
                        onChange={toggleAllVisible}
                        style={{ cursor: 'pointer', width: '14px', height: '14px', accentColor: '#2563eb' }}
                      />
                    </th>
                    {([
                      { label: 'Campaign', key: 'campaign_name' },
                      { label: 'Objective', key: 'objective' },
                      { label: 'Goal', key: 'performance_goal' },
                      { label: 'Spend', key: 'spend' },
                      { label: 'Conv.', key: 'conversions' },
                      { label: 'CPA', key: 'cpa' },
                      ...(report.has_revenue ? [{ label: 'ROAS %', key: 'roas' as keyof Campaign }] : []),
                      { label: 'CTR', key: 'ctr' },
                      { label: 'CR', key: 'conversion_rate' },
                      { label: 'CPM', key: 'cpm' },
                      { label: 'Verdict', key: 'verdict' },
                    ] as { label: string; key: keyof Campaign }[]).map(col => (
                      <th key={col.key} style={{ padding: '11px 14px', textAlign: 'left', borderBottom: '1px solid #f1f1f4' }}>
                        <button onClick={() => { if (sortKey === col.key) setSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setSortKey(col.key); setSortDir('desc') } }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.7px', color: sortKey === col.key ? '#2563eb' : '#9ca3af', padding: 0, display: 'flex', alignItems: 'center', gap: '3px', whiteSpace: 'nowrap' }}>
                          {col.label}{sortKey === col.key && <span>{sortDir === 'desc' ? ' ↓' : ' ↑'}</span>}
                        </button>
                      </th>
                    ))}
                    <th style={{ padding: '11px 14px', textAlign: 'left', borderBottom: '1px solid #f1f1f4' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', position: 'relative' }}>
                        <span style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.7px', color: '#9ca3af' }}>Confidence</span>
                        <span style={{ fontSize: '10px', color: '#9ca3af', cursor: 'pointer', background: '#f1f5f9', borderRadius: '50%', width: '14px', height: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', flexShrink: 0 }}
                          onMouseEnter={() => setShowConfTooltip(true)} onMouseLeave={() => setShowConfTooltip(false)}>i</span>
                        {showConfTooltip && (
                          <div style={{ position: 'absolute', top: '22px', right: 0, background: '#fff', color: '#374151', borderRadius: '8px', padding: '10px 14px', fontSize: '11px', lineHeight: '1.6', zIndex: 50, width: '240px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', border: '1px solid #e8eaed' }}>
                            Claude's self-assessed certainty in its verdict (0–100). Based on data volume, signal clarity, and consistency across metrics.
                          </div>
                        )}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayCampaigns.map((c, i) => {
                    const isSelected = selectedCampaigns.has(c.campaign_name)
                    const isFiltered = activeCampaignFilter.has(c.campaign_name)
                    const isExpanded = expandedRow === c.campaign_name
                    const rowBg = isSelected ? '#eff6ff' : isFiltered ? '#fff7ed' : isExpanded ? '#f0f7ff' : i % 2 === 0 ? '#fff' : '#fafafa'
                    return (
                      <>
                        <tr key={c.campaign_name}
                          style={{ borderTop: '1px solid #f7f8fa', background: rowBg, cursor: 'pointer' }}
                          onMouseEnter={e => { if (!isSelected && !isFiltered && !isExpanded) e.currentTarget.style.background = '#f8faff' }}
                          onMouseLeave={e => { if (!isSelected && !isFiltered && !isExpanded) e.currentTarget.style.background = rowBg }}>
                          <td style={{ padding: '11px 14px' }} onClick={e => e.stopPropagation()}>
                            <input type="checkbox" checked={isSelected} onChange={() => toggleCampaign(c.campaign_name)}
                              style={{ cursor: 'pointer', width: '14px', height: '14px', accentColor: '#2563eb' }} />
                          </td>
                          <td style={{ padding: '11px 14px', maxWidth: '180px' }} onClick={() => setExpandedRow(isExpanded ? null : c.campaign_name)}>
                            <div style={{ fontWeight: '600', color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px' }} title={c.campaign_name}>
                              {isFiltered && <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#c2410c', flexShrink: 0 }} />}
                              {c.campaign_name}
                            </div>
                          </td>
                          <td style={{ padding: '11px 14px', color: '#64748b' }} onClick={() => setExpandedRow(isExpanded ? null : c.campaign_name)}>{c.objective || '—'}</td>
                          <td style={{ padding: '11px 14px', color: '#64748b' }} onClick={() => setExpandedRow(isExpanded ? null : c.campaign_name)}>{c.performance_goal || '—'}</td>
                          <td style={{ padding: '11px 14px', fontFamily: 'monospace', fontWeight: '700', color: '#111827' }} onClick={() => setExpandedRow(isExpanded ? null : c.campaign_name)}>{fmtSpend(Number(c.spend))}</td>
                          <td style={{ padding: '11px 14px', fontFamily: 'monospace' }} onClick={() => setExpandedRow(isExpanded ? null : c.campaign_name)}>{c.conversions.toLocaleString()}</td>
                          <td style={{ padding: '11px 14px', fontFamily: 'monospace' }} onClick={() => setExpandedRow(isExpanded ? null : c.campaign_name)}>{fmt(c.cpa, '$')}</td>
                          {report.has_revenue && (
                            <td style={{ padding: '11px 14px', fontFamily: 'monospace' }} onClick={() => setExpandedRow(isExpanded ? null : c.campaign_name)}>{c.roas != null ? `${(Number(c.roas) * 100).toFixed(0)}%` : '—'}</td>
                          )}
                          <td style={{ padding: '11px 14px', fontFamily: 'monospace' }} onClick={() => setExpandedRow(isExpanded ? null : c.campaign_name)}>{fmt(c.ctr, '', '%')}</td>
                          <td style={{ padding: '11px 14px', fontFamily: 'monospace' }} onClick={() => setExpandedRow(isExpanded ? null : c.campaign_name)}>{fmt(c.conversion_rate, '', '%')}</td>
                          <td style={{ padding: '11px 14px', fontFamily: 'monospace' }} onClick={() => setExpandedRow(isExpanded ? null : c.campaign_name)}>{fmt(c.cpm, '$')}</td>
                          <td style={{ padding: '11px 14px' }} onClick={() => setExpandedRow(isExpanded ? null : c.campaign_name)}>
                            <span style={{ padding: '3px 9px', borderRadius: '5px', fontSize: '10px', fontWeight: '700', background: vbg(c.verdict), color: vc(c.verdict) }}>{c.verdict}</span>
                          </td>
                          <td style={{ padding: '11px 14px', fontFamily: 'monospace', color: '#64748b', fontWeight: '600' }} onClick={() => setExpandedRow(isExpanded ? null : c.campaign_name)}>{c.confidence}</td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${c.campaign_name}-exp`}>
                            <td colSpan={report.has_revenue ? 13 : 12} style={{ padding: '16px 22px', background: '#f0f7ff', borderTop: '1px solid #dbeafe' }}>
                              {c.primary_issue && (
                                <div style={{ fontSize: '12px', color: '#dc2626', fontWeight: '600', marginBottom: '8px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                                  <span>⚠</span> {c.primary_issue}
                                </div>
                              )}
                              <div style={{ fontSize: '12px', color: '#374151', lineHeight: '1.7' }}>
                                <strong style={{ color: '#111827' }}>Recommendation: </strong>{c.recommendation}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>

                {/* ── Subtotal row — always visible, reflects table contents ── */}
                {subtotal && (
                  <tfoot>
                    <tr style={{ background: '#f1f5f9', borderTop: '2px solid #e2e8f0' }}>
                      <td style={{ padding: '10px 14px' }} />
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: '#475569' }}>
                          Subtotal ({displayCampaigns.length})
                        </span>
                      </td>
                      <td colSpan={2} style={{ padding: '10px 14px' }} />
                      <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: '800', color: '#111827' }}>{fmtSpend(subtotal.spend)}</td>
                      <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: '700', color: '#111827' }}>{subtotal.conversions.toLocaleString()}</td>
                      <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: '700', color: '#111827' }}>{fmt(subtotal.cpa, '$')}</td>
                      {report.has_revenue && (
                        <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: '700', color: '#111827' }}>{subtotal.roas != null ? `${(subtotal.roas * 100).toFixed(0)}%` : '—'}</td>
                      )}
                      <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: '700', color: '#111827' }}>{fmt(subtotal.ctr, '', '%')}</td>
                      <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: '700', color: '#111827' }}>{fmt(subtotal.conversion_rate, '', '%')}</td>
                      <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: '700', color: '#111827' }}>{fmt(subtotal.cpm, '$')}</td>
                      <td colSpan={2} style={{ padding: '10px 14px' }} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* ── Action Plan ── */}
          <div ref={sectionRefs.actions}>
            <span style={secLabel}>Action Plan</span>
            <div style={{ ...card, padding: '22px', marginBottom: '14px', borderLeft: '4px solid #dc2626' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#dc2626' }} />
                <span style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: '#dc2626' }}>Immediate Actions</span>
                <span style={{ fontSize: '11px', color: '#9ca3af', fontWeight: '400' }}>— Take action today</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
                {((activeAnalysis?.action_plan ?? report.action_plan).immediate || []).map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: '#fff9f9', borderRadius: '8px', padding: '12px', border: '1px solid #fee2e2' }}>
                    <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#fef2f2', border: '1px solid #fca5a5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '10px', fontWeight: '700', color: '#dc2626' }}>{i + 1}</div>
                    <span style={{ fontSize: '12px', lineHeight: '1.65', color: '#374151' }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
              {[
                { label: 'This Week', key: 'this_week', color: '#d97706', dot: '#fcd34d' },
                { label: 'Next Week', key: 'next_week', color: '#2563eb', dot: '#93c5fd' },
              ].map(({ label, key, color, dot }) => (
                <div key={key} style={{ ...card, padding: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '14px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color }} />
                    <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color }}>{label}</span>
                  </div>
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {((activeAnalysis?.action_plan ?? report.action_plan)[key as keyof typeof report.action_plan] || []).map((item, i) => (
                      <li key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                        <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: dot, marginTop: '8px', flexShrink: 0 }} />
                        <span style={{ fontSize: '12px', lineHeight: '1.65', color: '#374151' }}>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              {(activeAnalysis?.budget_reallocation ?? report.budget_reallocation) && (
                <div style={{ ...card, padding: '18px', borderLeft: '3px solid #d97706' }}>
                  <span style={{ ...secLabel, color: '#d97706' }}>Budget Reallocation</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {(activeAnalysis?.budget_reallocation ?? report.budget_reallocation)!
                      .split('\n').filter((l: string) => l.trim())
                      .map((line: string, i: number) => (
                        <span key={i} style={{ fontSize: '13px', lineHeight: '1.65', color: '#374151', display: 'block' }}>{line.trim()}</span>
                      ))}
                  </div>
                </div>
              )}
              <div style={{ ...card, padding: '18px', borderLeft: '3px solid #16a34a' }}>
                <span style={{ ...secLabel, color: '#16a34a' }}>Next Test</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {(activeAnalysis?.next_test ?? report.next_test)!
                      .split('\n').filter((l: string) => l.trim())
                      .map((line: string, i: number) => (
                        <span key={i} style={{ fontSize: '13px', lineHeight: '1.65', color: '#374151', display: 'block' }}>{line.trim()}</span>
                      ))}
                  </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}