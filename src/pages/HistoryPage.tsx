import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

interface Report {
  id: string
  created_at: string
  client_id: string | null
  client_name: string | null
  file_name: string
  date_range_start: string | null
  date_range_end: string | null
  conversion_label: string
  overall_health: string
  total_spend: number
  total_conversions: number
}

const hc = (h: string) => h === 'STRONG' ? '#16a34a' : h === 'STABLE' ? '#2563eb' : h === 'AT_RISK' ? '#d97706' : '#dc2626'
const hbg = (h: string) => h === 'STRONG' ? '#f0fdf4' : h === 'STABLE' ? '#eff6ff' : h === 'AT_RISK' ? '#fffbeb' : '#fef2f2'
const fmtM = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n.toFixed(0)}`

const getClientLabel = (r: Report) => r.client_name || r.conversion_label || 'Unknown'

export default function HistoryPage() {
  const navigate = useNavigate()
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleteModal, setDeleteModal] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [filterClient, setFilterClient] = useState('')

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('reports')
      .select('id, created_at, client_id, client_name, file_name, date_range_start, date_range_end, conversion_label, overall_health, total_spend, total_conversions')
      .order('created_at', { ascending: false })
    if (!error) setReports(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const clientLabels = [...new Set(reports.map(getClientLabel))]

  const visible = reports.filter(r => !filterClient || getClientLabel(r) === filterClient)

  const grouped = visible.reduce((acc, r) => {
    const key = getClientLabel(r)
    if (!acc[key]) acc[key] = []
    acc[key].push(r)
    return acc
  }, {} as Record<string, Report[]>)

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const allSelected = visible.length > 0 && visible.every(r => selected.has(r.id))
  const toggleAll = () => allSelected ? setSelected(new Set()) : setSelected(new Set(visible.map(r => r.id)))

  const handleDelete = async () => {
    setDeleting(true)
    const ids = [...selected]
    for (const id of ids) {
      await supabase.from('reports').delete().eq('id', id)
    }
    setSelected(new Set())
    setDeleteModal(false)
    setDeleting(false)
    await load()
  }

  const card = { background: '#fff', borderRadius: '14px', border: '1px solid #f1f1f4', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }

  return (
    <div style={{ minHeight: '100vh', background: '#f7f8fa', fontFamily: "'Inter', -apple-system, sans-serif" }}>

      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #f1f1f4', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
        <div style={{ maxWidth: '960px', margin: '0 auto', padding: '0 28px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '28px', height: '28px', background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#fff', fontSize: '13px', fontWeight: '800' }}>M</span>
            </div>
            <span style={{ fontWeight: '800', fontSize: '14px', color: '#111827', letterSpacing: '-0.3px', cursor: 'pointer' }} onClick={() => navigate('/')}>AI Media Buyer</span>
          </div>
          <button onClick={() => navigate('/')} style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid #e8eaed', background: '#fff', fontSize: '12px', fontWeight: '600', color: '#374151', cursor: 'pointer' }}>
            + New Analysis
          </button>
        </div>
      </div>

      <div style={{ maxWidth: '960px', margin: '0 auto', padding: '32px 28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#111827', margin: 0, letterSpacing: '-0.6px' }}>Report History</h1>
            <p style={{ fontSize: '12px', color: '#9ca3af', margin: '5px 0 0' }}>
              {reports.length} reports · {Object.keys(grouped).length} clients
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {clientLabels.length > 1 && (
              <select value={filterClient} onChange={e => setFilterClient(e.target.value)}
                style={{ padding: '7px 12px', borderRadius: '8px', border: '1px solid #e8eaed', fontSize: '12px', outline: 'none', cursor: 'pointer', color: '#374151', background: '#fff', fontFamily: 'inherit' }}>
                <option value="">All Clients</option>
                {clientLabels.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
            {selected.size > 0 && (
              <button onClick={() => setDeleteModal(true)}
                style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid #fecaca', background: '#fef2f2', fontSize: '12px', fontWeight: '700', color: '#dc2626', cursor: 'pointer' }}>
                Delete {selected.size} selected
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '80px', color: '#9ca3af', fontSize: '14px' }}>Loading...</div>
        ) : Object.keys(grouped).length === 0 ? (
          <div style={{ ...card, padding: '80px', textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: '16px' }}>📊</div>
            <div style={{ fontSize: '17px', fontWeight: '700', color: '#374151', marginBottom: '8px' }}>No reports yet</div>
            <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '24px' }}>Run your first analysis to see it here</div>
            <button onClick={() => navigate('/')} style={{ padding: '10px 24px', borderRadius: '9px', background: '#2563eb', color: '#fff', border: 'none', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>
              Start Analysis →
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', padding: '0 2px' }}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ cursor: 'pointer', width: '14px', height: '14px' }} />
              <span style={{ fontSize: '11px', color: '#9ca3af', fontWeight: '600' }}>
                {allSelected ? 'Deselect all' : `Select all (${visible.length})`}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
              {Object.entries(grouped).map(([clientName, clientReports]) => (
                <div key={clientName}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                    <div style={{ width: '34px', height: '34px', borderRadius: '9px', background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: '800', fontSize: '14px', flexShrink: 0 }}>
                      {clientName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: '800', color: '#111827', letterSpacing: '-0.3px' }}>{clientName}</div>
                      <div style={{ fontSize: '11px', color: '#9ca3af' }}>{clientReports.length} report{clientReports.length !== 1 ? 's' : ''}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {clientReports.map(r => (
                      <div key={r.id}
                        style={{ ...card, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
                        onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)')}
                        onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.05)')}
                        onClick={() => navigate(`/report/${r.id}`)}>

                        <div onClick={e => { e.stopPropagation(); toggleSelect(r.id) }} style={{ flexShrink: 0 }}>
                          <input type="checkbox" checked={selected.has(r.id)} readOnly
                            style={{ cursor: 'pointer', width: '14px', height: '14px' }}
                            onClick={e => { e.stopPropagation(); toggleSelect(r.id) }} />
                        </div>

                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 10px', borderRadius: '20px', background: hbg(r.overall_health), border: `1px solid ${hc(r.overall_health)}25`, flexShrink: 0 }}>
                          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: hc(r.overall_health) }} />
                          <span style={{ fontSize: '10px', fontWeight: '700', color: hc(r.overall_health) }}>{r.overall_health}</span>
                        </div>

                        <div style={{ fontSize: '12px', color: '#64748b', flexShrink: 0, fontFamily: 'monospace', fontWeight: '500' }}>
                          {r.date_range_start} → {r.date_range_end}
                        </div>

                        <div style={{ display: 'flex', gap: '20px', flexShrink: 0 }}>
                          <div>
                            <div style={{ fontSize: '14px', fontWeight: '800', color: '#111827', fontFamily: 'monospace', letterSpacing: '-0.5px' }}>{fmtM(r.total_spend)}</div>
                            <div style={{ fontSize: '9px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600' }}>Spend</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '14px', fontWeight: '800', color: '#111827', fontFamily: 'monospace', letterSpacing: '-0.5px' }}>{r.total_conversions.toLocaleString()}</div>
                            <div style={{ fontSize: '9px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600' }}>{r.conversion_label}</div>
                          </div>
                        </div>

                        <div style={{ flex: 1, fontSize: '11px', color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.file_name}</div>

                        <div style={{ fontSize: '11px', color: '#9ca3af', flexShrink: 0 }}>
                          {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>

                        <span style={{ fontSize: '14px', color: '#d1d5db', flexShrink: 0 }}>→</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Delete modal */}
      {deleteModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
          onClick={() => !deleting && setDeleteModal(false)}>
          <div style={{ ...card, padding: '32px', maxWidth: '380px', width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '18px', fontWeight: '800', color: '#111827', marginBottom: '8px', letterSpacing: '-0.4px' }}>
              Delete {selected.size} report{selected.size !== 1 ? 's' : ''}?
            </div>
            <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '28px', lineHeight: '1.65' }}>
              This will permanently delete the selected reports and all associated data. This cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={handleDelete} disabled={deleting}
                style={{ flex: 1, padding: '11px', borderRadius: '9px', border: 'none', background: '#dc2626', color: '#fff', fontSize: '13px', fontWeight: '700', cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.7 : 1 }}>
                {deleting ? 'Deleting...' : 'Delete permanently'}
              </button>
              <button onClick={() => setDeleteModal(false)} disabled={deleting}
                style={{ flex: 1, padding: '11px', borderRadius: '9px', border: '1px solid #e8eaed', background: '#fff', fontSize: '13px', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}