import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import * as XLSX from 'xlsx'

interface ClientProfile {
  id: string
  client_name: string
  column_mapping: Record<string, string>
  conversion_label: string
  secondary_label: string | null
  kpi_targets: Record<string, string | number>
}

interface FormData {
  clientId: string | null
  clientName: string
  file: File | null
  fileHeaders: string[]
  rowCount: number
  columnMap: Record<string, string>
  conversionLabel: string
  secondaryLabel: string
  primaryKpi: string
  secondaryKpi: string
  objectiveKpiMap: Record<string, string>
  kpiTargets: {
    cpa: string
    conversion_rate: string
    ctr: string
    roas: string
    max_frequency: string
  }
  saveToProfile: boolean
}

interface AccountAverages {
  cpa: number | null
  conversion_rate: number | null
  ctr: number | null
  roas: number | null
  frequency: number | null
}

const REQUIRED_FIELDS = [
  { key: 'campaign_name', label: 'Campaign Name', required: true },
  { key: 'spend', label: 'Spend', required: true },
  { key: 'impressions', label: 'Impressions', required: true },
  { key: 'link_clicks', label: 'Link Clicks', required: true },
  { key: 'conversions', label: 'Conversions (Primary)', required: true },
]

const OPTIONAL_FIELDS = [
  { key: 'revenue', label: 'Revenue', required: false },
  { key: 'secondary_funnel_event', label: 'Secondary Funnel Event', required: false },
  { key: 'frequency', label: 'Frequency', required: false },
  { key: 'date', label: 'Date', required: false },
  { key: 'objective', label: 'Objective', required: false },
  { key: 'performance_goal', label: 'Performance Goal', required: false },
  { key: 'ad_set_name', label: 'Ad Set Name', required: false },
  { key: 'ad_name', label: 'Ad Name', required: false },
]

const KPI_OPTIONS = (hasRevenue: boolean) => [
  { value: 'roas', label: 'ROAS', disabled: !hasRevenue, hint: hasRevenue ? '' : 'Requires revenue column' },
  { value: 'cpa', label: 'CPA' },
  { value: 'conversion_rate', label: 'Conversion Rate' },
  { value: 'ctr', label: 'CTR' },
  { value: 'volume', label: 'Conversion Volume' },
  { value: 'cpm', label: 'CPM' },
  { value: 'frequency', label: 'Frequency' },
]

// Prettify Meta objective strings
const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_SALES: 'Sales',
  OUTCOME_TRAFFIC: 'Traffic',
  OUTCOME_LEADS: 'Lead Gen',
  OUTCOME_ENGAGEMENT: 'Engagement',
  OUTCOME_AWARENESS: 'Awareness',
  OUTCOME_APP_PROMOTION: 'App Installs',
  OUTCOME_STORE_VISITS: 'Store Visits',
}

// Default KPI suggestion per objective
const OBJECTIVE_DEFAULT_KPI: Record<string, string> = {
  OUTCOME_SALES: 'roas', // overridden to 'cpa' when no revenue
  OUTCOME_LEADS: 'cpa',
  OUTCOME_APP_PROMOTION: 'cpa',
  OUTCOME_TRAFFIC: 'ctr',
  OUTCOME_ENGAGEMENT: 'ctr',
  OUTCOME_AWARENESS: 'cpm',
  OUTCOME_STORE_VISITS: 'cpm',
}

function prettifyObjective(raw: string): string {
  if (OBJECTIVE_LABELS[raw]) return OBJECTIVE_LABELS[raw]
  // Title-case fallback: OUTCOME_FOO_BAR → Foo Bar
  return raw
    .replace(/^OUTCOME_/i, '')
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

export default function UploadPage() {
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState(0)
  const [profiles, setProfiles] = useState<ClientProfile[]>([])
  const [accountAverages, setAccountAverages] = useState<AccountAverages>({
    cpa: null, conversion_rate: null, ctr: null, roas: null, frequency: null
  })
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [rawData, setRawData] = useState<Record<string, unknown>[]>([])

  const [formData, setFormData] = useState<FormData>({
    clientId: null,
    clientName: '',
    file: null,
    fileHeaders: [],
    rowCount: 0,
    columnMap: {},
    conversionLabel: '',
    secondaryLabel: '',
    primaryKpi: 'cpa',
    secondaryKpi: 'conversion_rate',
    objectiveKpiMap: {},
    kpiTargets: { cpa: '', conversion_rate: '', ctr: '', roas: '', max_frequency: '' },
    saveToProfile: false,
  })

  useEffect(() => {
    supabase.from('client_profiles').select('*').order('client_name').then(({ data }: { data: any[] | null }) => {
      if (data) setProfiles(data)
    })
  }, [])

  const update = (fields: Partial<FormData>) =>
    setFormData(prev => ({ ...prev, ...fields }))

  const hasRevenue = !!formData.columnMap['revenue']
  const hasObjectiveColumn = !!formData.columnMap['objective']

  // Unique objectives found in the uploaded data
  const uniqueObjectives = useMemo(() => {
    if (!hasObjectiveColumn || !rawData.length) return []
    const col = formData.columnMap['objective']
    const seen = new Set<string>()
    for (const row of rawData) {
      const val = row[col]
      if (val && typeof val === 'string' && val.trim()) seen.add(val.trim())
    }
    return Array.from(seen).sort()
  }, [rawData, formData.columnMap, hasObjectiveColumn])

  // Whether objective mapping step is active
  const showObjectiveStep = hasObjectiveColumn && uniqueObjectives.length > 0

  // Dynamic steps
  const STEPS = showObjectiveStep
    ? ['Client', 'Upload', 'Mapping', 'Conversion', 'Objectives', 'Targets', 'Run']
    : ['Client', 'Upload', 'Mapping', 'Conversion', 'Targets', 'Run']

  // Step indices (logical, not display)
  const STEP_TARGETS = showObjectiveStep ? 5 : 4
  const STEP_RUN = showObjectiveStep ? 6 : 5

  // Auto-suggest primary KPI when revenue mapping changes
  useEffect(() => {
    if (hasRevenue && formData.primaryKpi === 'cpa') {
      update({ primaryKpi: 'roas', secondaryKpi: 'cpa' })
    } else if (!hasRevenue && formData.primaryKpi === 'roas') {
      update({ primaryKpi: 'cpa', secondaryKpi: 'conversion_rate' })
    }
  }, [hasRevenue])

  // Auto-populate objective KPI map when objectives are first detected
  useEffect(() => {
    if (!showObjectiveStep || !uniqueObjectives.length) return
    const map: Record<string, string> = {}
    for (const obj of uniqueObjectives) {
      // Default suggestion — fall back to cpa if no revenue for ROAS objectives
      const suggested = OBJECTIVE_DEFAULT_KPI[obj] || 'cpa'
      map[obj] = (suggested === 'roas' && !hasRevenue) ? 'cpa' : suggested
    }
    // Only set if not already set (don't overwrite user changes)
    update({ objectiveKpiMap: { ...map, ...formData.objectiveKpiMap } })
  }, [uniqueObjectives.join(','), hasRevenue])

  const loadProfile = (profile: ClientProfile) => {
    update({
      clientId: profile.id,
      clientName: profile.client_name,
      columnMap: profile.column_mapping || {},
      conversionLabel: profile.conversion_label || '',
      secondaryLabel: profile.secondary_label || '',
      primaryKpi: (profile.kpi_targets?.primary_kpi as string) || 'cpa',
      secondaryKpi: (profile.kpi_targets?.secondary_kpi as string) || 'conversion_rate',
      kpiTargets: {
        cpa: profile.kpi_targets?.cpa?.toString() || '',
        conversion_rate: profile.kpi_targets?.conversion_rate?.toString() || '',
        ctr: profile.kpi_targets?.ctr?.toString() || '',
        roas: profile.kpi_targets?.roas?.toString() || '',
        max_frequency: profile.kpi_targets?.max_frequency?.toString() || '',
      }
    })
  }

  const calculateAccountAverages = (data: Record<string, unknown>[], map: Record<string, string>) => {
    const get = (row: Record<string, unknown>, key: string) => parseFloat(row[map[key]] as string) || 0
    const totals = data.reduce((acc: { spend: number; impressions: number; link_clicks: number; conversions: number; revenue: number; frequency: number }, row) => ({
      spend: acc.spend + get(row, 'spend'),
      impressions: acc.impressions + get(row, 'impressions'),
      link_clicks: acc.link_clicks + get(row, 'link_clicks'),
      conversions: acc.conversions + get(row, 'conversions'),
      revenue: acc.revenue + (map['revenue'] ? get(row, 'revenue') : 0),
      frequency: acc.frequency + get(row, 'frequency'),
    }), { spend: 0, impressions: 0, link_clicks: 0, conversions: 0, revenue: 0, frequency: 0 })

    setAccountAverages({
      cpa: totals.conversions > 0 ? totals.spend / totals.conversions : null,
      conversion_rate: totals.link_clicks > 0 ? (totals.conversions / totals.link_clicks) * 100 : null,
      ctr: totals.impressions > 0 ? (totals.link_clicks / totals.impressions) * 100 : null,
      roas: map['revenue'] && totals.spend > 0 ? totals.revenue / totals.spend : null,
      frequency: map['frequency'] ? totals.frequency / data.length : null,
    })
  }

  const handleFileUpload = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet)
        const headers = json.length > 0 ? Object.keys(json[0]) : []
        setRawData(json)

        const autoMap: Record<string, string> = { ...formData.columnMap }
        const allFields = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

        const hints: Record<string, string[]> = {
          campaign_name: ['campaignname', 'campaign'],
          spend: ['amountspent', 'spend', 'cost'],
          impressions: ['impressions'],
          link_clicks: ['linkclicks', 'linkclick'],
          conversions: ['conversions', 'results'],
          revenue: ['revenue', 'revenueamount', 'conversionvalue', 'purchasevalue'],
          secondary_funnel_event: ['denied', 'rejected', 'secondary', 'failed'],
          frequency: ['frequency'],
          date: ['date', 'day'],
          objective: ['objective'],
          performance_goal: ['performancegoal', 'goal'],
          ad_set_name: ['adsetname', 'adset'],
          ad_name: ['adname'],
        }

        for (const field of allFields) {
          if (autoMap[field.key]) continue
          const fieldHints = hints[field.key] || [normalize(field.label)]
          const match = headers.find(h => fieldHints.some(hint => normalize(h).includes(hint)))
          if (match) autoMap[field.key] = match
        }

        update({ file, fileHeaders: headers, rowCount: json.length, columnMap: autoMap })
      } catch {
        setError('File could not be read. Please ensure it is a valid .xlsx or .csv export.')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const runAnalysis = async () => {
    setError('')
    try {
      setProgress('Parsing your file...')
      await new Promise(r => setTimeout(r, 400))

      setProgress('Calculating KPIs across all campaigns...')
      await new Promise(r => setTimeout(r, 400))

      const kpiTargets: Record<string, number | string | Record<string, string>> = {
        cpa: parseFloat(formData.kpiTargets.cpa),
        conversion_rate: parseFloat(formData.kpiTargets.conversion_rate),
        ctr: parseFloat(formData.kpiTargets.ctr),
        max_frequency: parseFloat(formData.kpiTargets.max_frequency),
        primary_kpi: formData.primaryKpi,
        secondary_kpi: formData.secondaryKpi,
      }
      if (hasRevenue && formData.kpiTargets.roas) {
        kpiTargets.roas = parseFloat(formData.kpiTargets.roas)
      }
      if (showObjectiveStep && Object.keys(formData.objectiveKpiMap).length > 0) {
        kpiTargets.objective_kpi_map = formData.objectiveKpiMap
      }

      const payload = {
        rows: rawData,
        column_map: formData.columnMap,
        conversion_config: {
          conversion_label: formData.conversionLabel,
          secondary_label: formData.secondaryLabel || null,
          has_revenue: hasRevenue,
        },
        kpi_targets: kpiTargets,
        client_id: formData.clientId,
        client_name: formData.clientName,
        save_to_profile: formData.saveToProfile,
        file_name: formData.file?.name || 'unknown',
      }

      setProgress('Sending data to AI analyst...')
      const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_URL
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      setProgress('AI is analyzing your campaigns...')
      const text = await response.text()
      const result = JSON.parse(text)

      if (result.error) {
        setError(result.message)
        setProgress('')
        return
      }

      setProgress('Saving your report...')
      await new Promise(r => setTimeout(r, 300))
      navigate(`/report/${result.report_id}`)
    } catch {
      setError('Something went wrong. Please try again.')
      setProgress('')
    }
  }

  const cardStyle = {
    background: 'var(--bg-card)',
    borderRadius: '12px',
    boxShadow: 'var(--shadow-md)',
    border: '1px solid var(--border)',
    padding: '24px',
  }

  const inputStyle = {
    width: '100%',
    padding: '10px 14px',
    borderRadius: '8px',
    border: '1.5px solid var(--border)',
    color: 'var(--text-primary)',
    background: '#fff',
    fontSize: '14px',
    outline: 'none',
    boxSizing: 'border-box' as const,
  }

  const selectStyle = { ...inputStyle, cursor: 'pointer' }

  const primaryBtn = {
    padding: '10px 24px',
    borderRadius: '8px',
    background: 'var(--blue)',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '600',
    border: 'none',
    cursor: 'pointer',
    transition: 'background 0.15s',
  }

  const ghostBtn = {
    padding: '10px 16px',
    borderRadius: '8px',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: '14px',
    border: 'none',
    cursor: 'pointer',
  }

  // KPI target fields
  const kpiFields = [
    { label: 'CPA Target ($)', key: 'cpa', placeholder: 'e.g. 55', avg: accountAverages.cpa, prefix: '$', suffix: '' },
    { label: 'Conversion Rate (%)', key: 'conversion_rate', placeholder: 'e.g. 0.65', avg: accountAverages.conversion_rate, prefix: '', suffix: '%' },
    { label: 'CTR (%)', key: 'ctr', placeholder: 'e.g. 0.9', avg: accountAverages.ctr, prefix: '', suffix: '%' },
    ...(hasRevenue ? [{ label: 'ROAS Target (%)', key: 'roas', placeholder: 'e.g. 90', avg: accountAverages.roas ? accountAverages.roas * 100 : null, prefix: '', suffix: '%' }] : []),
    { label: 'Max Frequency', key: 'max_frequency', placeholder: 'e.g. 3.0', avg: accountAverages.frequency, prefix: '', suffix: '' },
  ]

  const requiredTargetKeys = ['cpa', 'conversion_rate', 'ctr', 'max_frequency', ...(hasRevenue ? ['roas'] : [])]
  const step4Disabled = !formData.primaryKpi || !formData.secondaryKpi || formData.primaryKpi === formData.secondaryKpi ||
    requiredTargetKeys.some(k => !formData.kpiTargets[k as keyof typeof formData.kpiTargets])
  const stepTargetsDisabled = requiredTargetKeys.some(k => !formData.kpiTargets[k as keyof typeof formData.kpiTargets])

  const kpiOptions = KPI_OPTIONS(hasRevenue)

  const kpiLabel = (val: string) => kpiOptions.find(o => o.value === val)?.label || val.toUpperCase()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>

      {/* Header */}
      <div style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>
        <div style={{ maxWidth: '720px', margin: '0 auto', padding: '0 24px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: '700', fontSize: '15px', color: 'var(--blue)', letterSpacing: '-0.3px' }}>AI Media Buyer</span>
          <button onClick={() => navigate('/history')} style={{ ...ghostBtn, fontSize: '13px' }}>History →</button>
        </div>
      </div>

      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '32px 24px' }}>

        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '32px' }}>
          {STEPS.map((step, i) => (
            <div key={step} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{
                  width: '26px', height: '26px', borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '12px', fontWeight: '600',
                  background: i === currentStep ? 'var(--blue)' : i < currentStep ? 'var(--green)' : '#e4e6ea',
                  color: i <= currentStep ? '#fff' : 'var(--text-secondary)',
                }}>
                  {i < currentStep ? '✓' : i + 1}
                </div>
                <span style={{
                  fontSize: '13px', fontWeight: i === currentStep ? '600' : '400',
                  color: i === currentStep ? 'var(--text-primary)' : 'var(--text-secondary)',
                  display: window.innerWidth < 500 ? 'none' : 'block'
                }}>
                  {step}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ width: '20px', height: '1px', background: 'var(--border)', margin: '0 2px' }} />
              )}
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div style={{ marginBottom: '16px', padding: '12px 16px', borderRadius: '8px', background: '#fff0f0', color: 'var(--red)', border: '1px solid #ffd0d0', fontSize: '14px' }}>
            {error}
          </div>
        )}

        {/* ── Step 0: Client Profile ── */}
        {currentStep === 0 && (
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '4px' }}>Select Client</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px' }}>Load a saved profile or create a new client.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {profiles.map(p => (
                <button key={p.id} onClick={() => { loadProfile(p); setCurrentStep(1) }}
                  style={{ ...cardStyle, textAlign: 'left', cursor: 'pointer', border: '1.5px solid var(--border)', transition: 'border-color 0.15s' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--blue)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
                  <div style={{ fontWeight: '600', fontSize: '14px' }}>{p.client_name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    CPA target: ${p.kpi_targets?.cpa} · Primary KPI: {(p.kpi_targets?.primary_kpi as string || 'cpa').toUpperCase()}
                  </div>
                </button>
              ))}
              <div style={cardStyle}>
                <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '10px' }}>+ New client</div>
                <input style={inputStyle} placeholder="Client name"
                  value={formData.clientName}
                  onChange={e => update({ clientName: e.target.value, clientId: null })} />
              </div>
            </div>
            <div style={{ marginTop: '24px' }}>
              <button onClick={() => { if (formData.clientName) setCurrentStep(1) }}
                disabled={!formData.clientName}
                style={{ ...primaryBtn, opacity: formData.clientName ? 1 : 0.4 }}>
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 1: File Upload ── */}
        {currentStep === 1 && (
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '4px' }}>Upload File</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px' }}>Upload your Meta Ads export (.xlsx or .csv)</p>
            <label style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              width: '100%', height: '160px', borderRadius: '12px',
              border: '2px dashed var(--border)', cursor: 'pointer',
              background: '#fff', transition: 'border-color 0.15s',
            }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--blue)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
              <input type="file" accept=".xlsx,.csv" style={{ display: 'none' }}
                onChange={e => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]) }} />
              {formData.file ? (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '28px', marginBottom: '8px' }}>✅</div>
                  <div style={{ fontWeight: '600', fontSize: '14px' }}>{formData.file.name}</div>
                  <div style={{ fontSize: '13px', color: 'var(--green)', marginTop: '4px' }}>
                    {formData.rowCount} rows · {formData.fileHeaders.length} columns detected
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '28px', marginBottom: '8px' }}>📁</div>
                  <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Click to upload .xlsx or .csv</div>
                </div>
              )}
            </label>
            <div style={{ display: 'flex', gap: '8px', marginTop: '24px' }}>
              <button onClick={() => setCurrentStep(0)} style={ghostBtn}>← Back</button>
              <button onClick={() => setCurrentStep(2)} disabled={!formData.file}
                style={{ ...primaryBtn, opacity: formData.file ? 1 : 0.4 }}>Continue →</button>
            </div>
          </div>
        )}

        {/* ── Step 2: Column Mapping ── */}
        {currentStep === 2 && (
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '4px' }}>Map Columns</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
              Columns were auto-mapped from your file. Review and adjust if needed.
            </p>
            <div style={cardStyle}>
              <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-secondary)', marginBottom: '16px' }}>Required Fields</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
                {REQUIRED_FIELDS.map(field => (
                  <div key={field.key} style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ width: '180px', fontSize: '13px', fontWeight: '500', flexShrink: 0 }}>
                      {field.label} <span style={{ color: 'var(--red)' }}>*</span>
                    </div>
                    <select style={selectStyle} value={formData.columnMap[field.key] || ''}
                      onChange={e => update({ columnMap: { ...formData.columnMap, [field.key]: e.target.value } })}>
                      <option value="">Select column...</option>
                      {formData.fileHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-secondary)', marginBottom: '16px' }}>Optional Fields</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {OPTIONAL_FIELDS.map(field => (
                  <div key={field.key} style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ width: '180px', fontSize: '13px', color: 'var(--text-secondary)', flexShrink: 0 }}>
                      {field.label}
                      {field.key === 'revenue' && (
                        <span style={{ display: 'block', fontSize: '11px', color: 'var(--blue)', marginTop: '2px' }}>Enables ROAS analysis</span>
                      )}
                      {field.key === 'objective' && (
                        <span style={{ display: 'block', fontSize: '11px', color: 'var(--blue)', marginTop: '2px' }}>Enables per-objective KPI routing</span>
                      )}
                    </div>
                    <select style={selectStyle} value={formData.columnMap[field.key] || ''}
                      onChange={e => update({ columnMap: { ...formData.columnMap, [field.key]: e.target.value } })}>
                      <option value="">Not in my file</option>
                      {formData.fileHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '24px' }}>
              <button onClick={() => setCurrentStep(1)} style={ghostBtn}>← Back</button>
              <button onClick={() => setCurrentStep(3)}
                disabled={REQUIRED_FIELDS.some(f => !formData.columnMap[f.key])}
                style={{ ...primaryBtn, opacity: REQUIRED_FIELDS.some(f => !formData.columnMap[f.key]) ? 0.4 : 1 }}>
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Conversion Settings ── */}
        {currentStep === 3 && (
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '4px' }}>Conversion Settings</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px' }}>Define what a conversion means for this client.</p>
            <div style={cardStyle}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '6px' }}>Conversion event label</label>
                  <input style={inputStyle} placeholder="e.g. Credit Card Approval"
                    value={formData.conversionLabel}
                    onChange={e => update({ conversionLabel: e.target.value })} />
                </div>
                {formData.columnMap['secondary_funnel_event'] && (
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '6px' }}>Secondary event label</label>
                    <input style={inputStyle} placeholder="e.g. Denied Application"
                      value={formData.secondaryLabel}
                      onChange={e => update({ secondaryLabel: e.target.value })} />
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '24px' }}>
              <button onClick={() => setCurrentStep(2)} style={ghostBtn}>← Back</button>
              <button
                onClick={() => {
                  calculateAccountAverages(rawData, formData.columnMap)
                  setCurrentStep(showObjectiveStep ? 4 : STEP_TARGETS)
                }}
                disabled={!formData.conversionLabel}
                style={{ ...primaryBtn, opacity: !formData.conversionLabel ? 0.4 : 1 }}>
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Objective → KPI Mapping (conditional) ── */}
        {currentStep === 4 && showObjectiveStep && (
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '4px' }}>Objective KPI Mapping</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
              Select which KPI each campaign objective should be evaluated on. Pre-suggestions are based on Meta best practices.
            </p>
            <div style={cardStyle}>
              <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                {uniqueObjectives.length} objective{uniqueObjectives.length !== 1 ? 's' : ''} found in your file
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {uniqueObjectives.map(obj => (
                  <div key={obj} style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    {/* Objective label */}
                    <div style={{ flex: '0 0 200px' }}>
                      <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>
                        {prettifyObjective(obj)}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px', fontFamily: 'monospace' }}>
                        {obj}
                      </div>
                    </div>
                    {/* Arrow */}
                    <div style={{ fontSize: '16px', color: 'var(--text-secondary)', flexShrink: 0 }}>→</div>
                    {/* KPI dropdown */}
                    <div style={{ flex: 1 }}>
                      <select
                        style={selectStyle}
                        value={formData.objectiveKpiMap[obj] || 'cpa'}
                        onChange={e => update({
                          objectiveKpiMap: { ...formData.objectiveKpiMap, [obj]: e.target.value }
                        })}>
                        {kpiOptions.map(o => (
                          <option key={o.value} value={o.value} disabled={o.disabled}>
                            {o.label}{o.hint ? ` (${o.hint})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    {/* Suggested badge */}
                    {formData.objectiveKpiMap[obj] === (
                      OBJECTIVE_DEFAULT_KPI[obj] === 'roas' && !hasRevenue ? 'cpa' : (OBJECTIVE_DEFAULT_KPI[obj] || 'cpa')
                    ) && (
                      <div style={{
                        fontSize: '10px', fontWeight: '700', color: 'var(--green)',
                        background: '#f0fdf4', border: '1px solid #bbf7d0',
                        borderRadius: '4px', padding: '2px 6px', flexShrink: 0
                      }}>
                        SUGGESTED
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '24px' }}>
              <button onClick={() => setCurrentStep(3)} style={ghostBtn}>← Back</button>
              <button onClick={() => setCurrentStep(STEP_TARGETS)} style={primaryBtn}>
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── Step Targets: KPI Targets ── */}
        {currentStep === STEP_TARGETS && (
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '4px' }}>KPI Targets</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
              Set your performance targets. These thresholds drive verdict decisions.
            </p>

            {/* Primary & Secondary KPI selectors — only shown when no objective mapping */}
            {!showObjectiveStep && (
              <div style={cardStyle}>
                <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-secondary)', marginBottom: '16px' }}>Verdict KPIs</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '4px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>
                      Primary KPI
                      <span style={{ fontSize: '11px', fontWeight: '400', color: 'var(--text-secondary)', marginLeft: '6px' }}>drives verdicts</span>
                    </label>
                    <select style={selectStyle} value={formData.primaryKpi}
                      onChange={e => update({ primaryKpi: e.target.value })}>
                      {kpiOptions.map(o => (
                        <option key={o.value} value={o.value} disabled={o.disabled || o.value === formData.secondaryKpi}>
                          {o.label}{o.hint ? ` (${o.hint})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>
                      Secondary KPI
                      <span style={{ fontSize: '11px', fontWeight: '400', color: 'var(--text-secondary)', marginLeft: '6px' }}>informs recommendations</span>
                    </label>
                    <select style={selectStyle} value={formData.secondaryKpi}
                      onChange={e => update({ secondaryKpi: e.target.value })}>
                      {kpiOptions.map(o => (
                        <option key={o.value} value={o.value} disabled={o.disabled || o.value === formData.primaryKpi}>
                          {o.label}{o.hint ? ` (${o.hint})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {formData.primaryKpi === formData.secondaryKpi && (
                  <div style={{ fontSize: '12px', color: 'var(--red)', marginTop: '8px' }}>Primary and secondary KPI must be different.</div>
                )}
              </div>
            )}

            {/* Objective mapping summary — shown when objective step was completed */}
            {showObjectiveStep && (
              <div style={{ ...cardStyle, marginBottom: '16px', background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: '#16a34a', marginBottom: '12px' }}>
                  ✓ Objective KPI Routing Active
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {uniqueObjectives.map(obj => (
                    <div key={obj} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{prettifyObjective(obj)}</span>
                      <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                        {kpiLabel(formData.objectiveKpiMap[obj] || 'cpa')}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setCurrentStep(4)}
                  style={{ marginTop: '12px', fontSize: '12px', color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  ← Edit objective mapping
                </button>
              </div>
            )}

            {/* KPI Targets */}
            <div style={{ ...cardStyle, marginTop: showObjectiveStep ? '0' : '16px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-secondary)', marginBottom: '16px' }}>Performance Targets</div>
              {!hasRevenue && (
                <div style={{ marginBottom: '16px', padding: '10px 14px', borderRadius: '8px', background: '#fffbeb', border: '1px solid #fcd34d', fontSize: '13px', color: '#92400e' }}>
                  No revenue column mapped — ROAS analysis disabled. Analysis will focus on CPA, CTR, and conversion rate.
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {kpiFields.map(({ label, key, placeholder, avg, prefix, suffix }) => (
                  <div key={key}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <label style={{ fontSize: '13px', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {label}
                        {!showObjectiveStep && key === formData.primaryKpi && (
                          <span style={{ fontSize: '10px', fontWeight: '700', background: '#2563eb', color: '#fff', padding: '1px 6px', borderRadius: '4px' }}>PRIMARY</span>
                        )}
                        {!showObjectiveStep && key === formData.secondaryKpi && (
                          <span style={{ fontSize: '10px', fontWeight: '700', background: '#e0e7ff', color: '#2563eb', padding: '1px 6px', borderRadius: '4px' }}>SECONDARY</span>
                        )}
                      </label>
                      {avg !== null && avg !== undefined && (
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                          Account avg: {prefix}{avg.toFixed(2)}{suffix}
                        </span>
                      )}
                    </div>
                    <input
                      style={{
                        ...inputStyle,
                        background: formData.clientId ? 'var(--blue-soft)' : '#fff',
                        borderColor: formData.clientId ? 'var(--blue)' : 'var(--border)',
                      }}
                      placeholder={placeholder}
                      value={formData.kpiTargets[key as keyof typeof formData.kpiTargets]}
                      onChange={e => update({ kpiTargets: { ...formData.kpiTargets, [key]: e.target.value } })} />
                    {formData.clientId && (
                      <div style={{ fontSize: '11px', color: 'var(--blue)', marginTop: '4px' }}>Saved — confirm or update</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '24px' }}>
              <button onClick={() => setCurrentStep(showObjectiveStep ? 4 : 3)} style={ghostBtn}>← Back</button>
              <button onClick={() => setCurrentStep(STEP_RUN)}
                disabled={showObjectiveStep ? stepTargetsDisabled : step4Disabled}
                style={{ ...primaryBtn, opacity: (showObjectiveStep ? stepTargetsDisabled : step4Disabled) ? 0.4 : 1 }}>
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── Step Run: Run Analysis ── */}
        {currentStep === STEP_RUN && (
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '4px' }}>Run Analysis</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px' }}>Everything is configured. Ready to analyze.</p>
            <div style={cardStyle}>
              {[
                { label: 'Client', value: formData.clientName },
                { label: 'File', value: formData.file?.name },
                { label: 'Rows', value: formData.rowCount.toString() },
                ...(showObjectiveStep
                  ? uniqueObjectives.map(obj => ({
                      label: prettifyObjective(obj),
                      value: kpiLabel(formData.objectiveKpiMap[obj] || 'cpa'),
                    }))
                  : [
                      { label: 'Primary KPI', value: kpiLabel(formData.primaryKpi) },
                      { label: 'Secondary KPI', value: kpiLabel(formData.secondaryKpi) },
                    ]
                ),
                { label: 'CPA Target', value: `$${formData.kpiTargets.cpa}` },
                ...(hasRevenue ? [{ label: 'ROAS Target', value: `${formData.kpiTargets.roas}%` }] : []),
                { label: 'Revenue Data', value: hasRevenue ? '✓ Mapped' : 'Not available' },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{label}</span>
                  <span style={{ fontSize: '13px', fontWeight: '500' }}>{value}</span>
                </div>
              ))}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', margin: '20px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={formData.saveToProfile}
                onChange={e => update({ saveToProfile: e.target.checked })} />
              Save settings to {formData.clientName} profile
            </label>
            {progress && (
              <div style={{ marginBottom: '16px', padding: '12px 16px', borderRadius: '8px', background: 'var(--blue-soft)', border: '1px solid var(--blue)', fontSize: '13px', color: 'var(--blue)', fontWeight: '500' }}>
                <span style={{ marginRight: '8px', display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>
                {progress}
              </div>
            )}
            {error && (
              <div style={{ marginBottom: '16px', padding: '12px 16px', borderRadius: '8px', background: '#fff0f0', color: 'var(--red)', border: '1px solid #ffd0d0', fontSize: '14px' }}>
                {error}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setCurrentStep(STEP_TARGETS)} style={ghostBtn}>← Back</button>
              <button onClick={runAnalysis} disabled={!!progress}
                style={{ ...primaryBtn, opacity: progress ? 0.4 : 1 }}>
                {progress ? 'Running...' : 'Run Analysis →'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}