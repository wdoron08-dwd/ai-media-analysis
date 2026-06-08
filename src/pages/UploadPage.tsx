import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import * as XLSX from 'xlsx'

interface ClientProfile {
  id: string
  client_name: string
  column_mapping: Record<string, string>
  conversion_label: string
  secondary_label: string | null
  ltv_per_conversion: number
  kpi_targets: Record<string, number>
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
  ltvPerConversion: string
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
  { key: 'secondary_funnel_event', label: 'Secondary Funnel Event', required: false },
  { key: 'frequency', label: 'Frequency', required: false },
  { key: 'date', label: 'Date', required: false },
  { key: 'objective', label: 'Objective', required: false },
  { key: 'performance_goal', label: 'Performance Goal', required: false },
  { key: 'ad_set_name', label: 'Ad Set Name', required: false },
  { key: 'ad_name', label: 'Ad Name', required: false },
]

const STEPS = ['Client', 'Upload', 'Mapping', 'Conversion', 'Targets', 'Run']

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
    ltvPerConversion: '',
    kpiTargets: { cpa: '', conversion_rate: '', ctr: '', roas: '', max_frequency: '' },
    saveToProfile: false,
  })

  useEffect(() => {
    supabase.from('client_profiles').select('*').order('client_name').then(({ data }) => {
      if (data) setProfiles(data)
    })
  }, [])

  const update = (fields: Partial<FormData>) =>
    setFormData(prev => ({ ...prev, ...fields }))

  const loadProfile = (profile: ClientProfile) => {
    update({
      clientId: profile.id,
      clientName: profile.client_name,
      columnMap: profile.column_mapping || {},
      conversionLabel: profile.conversion_label || '',
      secondaryLabel: profile.secondary_label || '',
      ltvPerConversion: profile.ltv_per_conversion?.toString() || '',
      kpiTargets: {
        cpa: profile.kpi_targets?.cpa?.toString() || '',
        conversion_rate: profile.kpi_targets?.conversion_rate?.toString() || '',
        ctr: profile.kpi_targets?.ctr?.toString() || '',
        roas: profile.kpi_targets?.roas?.toString() || '',
        max_frequency: profile.kpi_targets?.max_frequency?.toString() || '',
      }
    })
  }

  const calculateAccountAverages = (data: Record<string, unknown>[], map: Record<string, string>, ltv: number) => {
    const get = (row: Record<string, unknown>, key: string) => parseFloat(row[map[key]] as string) || 0
    const totals = data.reduce((acc, row) => ({
      spend: acc.spend + get(row, 'spend'),
      impressions: acc.impressions + get(row, 'impressions'),
      link_clicks: acc.link_clicks + get(row, 'link_clicks'),
      conversions: acc.conversions + get(row, 'conversions'),
      frequency: acc.frequency + get(row, 'frequency'),
    }), { spend: 0, impressions: 0, link_clicks: 0, conversions: 0, frequency: 0 })

    const revenue = totals.conversions * ltv
    setAccountAverages({
      cpa: totals.conversions > 0 ? totals.spend / totals.conversions : null,
      conversion_rate: totals.link_clicks > 0 ? (totals.conversions / totals.link_clicks) * 100 : null,
      ctr: totals.impressions > 0 ? (totals.link_clicks / totals.impressions) * 100 : null,
      roas: totals.spend > 0 ? revenue / totals.spend : null,
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

      const ltv = parseFloat(formData.ltvPerConversion)

      const payload = {
        rows: rawData,
        column_map: formData.columnMap,
        conversion_config: {
          conversion_label: formData.conversionLabel,
          secondary_label: formData.secondaryLabel || null,
          ltv_per_conversion: ltv,
        },
        kpi_targets: {
          cpa: parseFloat(formData.kpiTargets.cpa),
          conversion_rate: parseFloat(formData.kpiTargets.conversion_rate),
          ctr: parseFloat(formData.kpiTargets.ctr),
          roas: parseFloat(formData.kpiTargets.roas),
          max_frequency: parseFloat(formData.kpiTargets.max_frequency),
        },
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
                    CPA target: ${p.kpi_targets?.cpa} · LTV: ${p.ltv_per_conversion}
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
                    <div style={{ width: '180px', fontSize: '13px', color: 'var(--text-secondary)', flexShrink: 0 }}>{field.label}</div>
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
                {[
                  { label: 'Conversion event label', key: 'conversionLabel', placeholder: 'e.g. Credit Card Approval' },
                  { label: 'LTV per conversion ($)', key: 'ltvPerConversion', placeholder: 'e.g. 180' },
                ].map(({ label, key, placeholder }) => (
                  <div key={key}>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '6px' }}>{label}</label>
                    <input style={inputStyle} placeholder={placeholder}
                      value={formData[key as keyof FormData] as string}
                      onChange={e => update({ [key]: e.target.value })} />
                  </div>
                ))}
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
                  if (formData.ltvPerConversion) {
                    calculateAccountAverages(rawData, formData.columnMap, parseFloat(formData.ltvPerConversion))
                    setCurrentStep(4)
                  }
                }}
                disabled={!formData.conversionLabel || !formData.ltvPerConversion}
                style={{ ...primaryBtn, opacity: (!formData.conversionLabel || !formData.ltvPerConversion) ? 0.4 : 1 }}>
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: KPI Targets ── */}
        {currentStep === 4 && (
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '4px' }}>KPI Targets</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
              Set performance targets. Your account averages are shown for reference.
            </p>
            <div style={cardStyle}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {[
                  { label: 'CPA Target ($)', key: 'cpa', placeholder: 'e.g. 55', avg: accountAverages.cpa, prefix: '$', suffix: '' },
                  { label: 'Conversion Rate (%)', key: 'conversion_rate', placeholder: 'e.g. 0.65', avg: accountAverages.conversion_rate, prefix: '', suffix: '%' },
                  { label: 'CTR (%)', key: 'ctr', placeholder: 'e.g. 0.9', avg: accountAverages.ctr, prefix: '', suffix: '%' },
                  { label: 'ROAS Target (%)', key: 'roas', placeholder: 'e.g. 300', avg: accountAverages.roas ? accountAverages.roas * 100 : null, prefix: '', suffix: '%' },
                  { label: 'Max Frequency', key: 'max_frequency', placeholder: 'e.g. 3.0', avg: accountAverages.frequency, prefix: '', suffix: '' },
                ].map(({ label, key, placeholder, avg, prefix, suffix }) => (
                  <div key={key}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <label style={{ fontSize: '13px', fontWeight: '500' }}>{label}</label>
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
              <button onClick={() => setCurrentStep(3)} style={ghostBtn}>← Back</button>
              <button onClick={() => setCurrentStep(5)}
                disabled={Object.values(formData.kpiTargets).some(v => !v)}
                style={{ ...primaryBtn, opacity: Object.values(formData.kpiTargets).some(v => !v) ? 0.4 : 1 }}>
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 5: Run ── */}
        {currentStep === 5 && (
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '4px' }}>Run Analysis</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px' }}>Everything is configured. Ready to analyze.</p>
            <div style={cardStyle}>
              {[
                { label: 'Client', value: formData.clientName },
                { label: 'File', value: formData.file?.name },
                { label: 'Rows', value: formData.rowCount.toString() },
                { label: 'CPA Target', value: `$${formData.kpiTargets.cpa}` },
                { label: 'ROAS Target', value: `${formData.kpiTargets.roas}%` },
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
              <button onClick={() => setCurrentStep(4)} style={ghostBtn}>← Back</button>
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