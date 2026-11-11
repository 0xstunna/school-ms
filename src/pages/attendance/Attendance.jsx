import { useState, useEffect, useCallback } from 'react';
import { ClipboardList, Save, CheckCircle, XCircle, Clock, BookmarkCheck } from 'lucide-react';
import { getStudents } from '../../db/studentService.js';
import { getAttendanceSession, saveAttendanceSession } from '../../db/attendanceService.js';
import { getConfig } from '../../db/configService.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { CLASSES, STREAMS } from '../../utils/constants.js';
import { getCurrentDateISO, formatDate } from '../../utils/grading.js';
import Button from '../../components/common/Button.jsx';
import { Select } from '../../components/common/Input.jsx';
import { EmptyState, PageHeader, Card, Badge, LoadingScreen } from '../../components/common/Badge.jsx';

const STATUS_CONFIG = {
  present: { label: 'Present', icon: CheckCircle,  color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100' },
  absent:  { label: 'Absent',  icon: XCircle,      color: 'text-red-600',     bg: 'bg-red-50 border-red-200 hover:bg-red-100'             },
  late:    { label: 'Late',    icon: Clock,         color: 'text-amber-600',   bg: 'bg-amber-50 border-amber-200 hover:bg-amber-100'       },
  excused: { label: 'Excused', icon: BookmarkCheck, color: 'text-blue-600',    bg: 'bg-blue-50 border-blue-200 hover:bg-blue-100'          },
};

const Attendance = () => {
  const { user, activeSchoolId } = useAuth();
  const [date, setDate]           = useState(getCurrentDateISO());
  const [classLevel, setClassLevel] = useState('S1');
  const [stream, setStream]       = useState('A');
  const [students, setStudents]   = useState([]);
  const [records, setRecords]     = useState({});
  const [config, setConfig]       = useState(null);
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);

  useEffect(() => {
    if (!activeSchoolId) return;
    getConfig(activeSchoolId).then(setConfig);
  }, [activeSchoolId]);

  const load = useCallback(async () => {
    if (!activeSchoolId) return;
    setLoading(true);
    setSaved(false);
    try {
      const classStream = `${classLevel}${stream}`;
      const [studentList, existing] = await Promise.all([
        getStudents({ schoolId: activeSchoolId, classLevel, stream, status: 'active' }),
        getAttendanceSession(date, classStream),
      ]);
      setStudents(studentList);
      if (existing) {
        const map = {};
        existing.records.forEach((r) => { map[r.studentId] = r.status; });
        setRecords(map);
      } else {
        const defaultMap = {};
        studentList.forEach((s) => { defaultMap[s.id] = 'present'; });
        setRecords(defaultMap);
      }
    } finally { setLoading(false); }
  }, [date, classLevel, stream, activeSchoolId]);

  useEffect(() => { load(); }, [load]);

  const setStatus = (studentId, status) =>
    setRecords((p) => ({ ...p, [studentId]: status }));

  const markAll = (status) => {
    const map = {};
    students.forEach((s) => { map[s.id] = status; }); 
    setRecords(map);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const classStream = `${classLevel}${stream}`;
      const recordsList = students.map((s) => ({
        studentId: s.id,
        studentName: s.fullName,
        status: records[s.id] || 'absent',
      }));
      await saveAttendanceSession(date, classStream, recordsList, user.id, {
        academicYear: config?.academicYear,
        term: config?.currentTerm,
      });
      setSaved(true);
    } finally { setSaving(false); }
  };

  const counts = Object.values(records).reduce((acc, s) => {
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Attendance" subtitle="Mark daily class attendance" />

      {/* Controls */}
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="h-9 px-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-navy-500" />
          </div>
          <Select label="Class" value={classLevel} onChange={(e) => setClassLevel(e.target.value)} className="w-28">
            {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select label="Stream" value={stream} onChange={(e) => setStream(e.target.value)} className="w-28">
            {STREAMS.map((s) => <option key={s} value={s}>Stream {s}</option>)}
          </Select>
          <div className="flex-1" />
          {/* Summary counts */}
          <div className="flex items-center gap-2">
            {Object.entries(STATUS_CONFIG).map(([status, cfg]) => (
              <div key={status} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${cfg.bg} ${cfg.color}`}>
                <span>{counts[status] || 0}</span>
                <span>{cfg.label}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Attendance sheet */}
      <Card padding={false}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div>
            <h3 className="font-display font-semibold text-slate-800">
              {classLevel}{stream} — {formatDate(date)}
            </h3>
            <p className="text-sm text-slate-500 mt-0.5">{students.length} students</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => markAll('present')}>All Present</Button>
            <Button variant="ghost" size="sm" onClick={() => markAll('absent')}>All Absent</Button>
            {saved ? (
              <div className="flex items-center gap-1.5 text-emerald-600 text-sm font-medium">
                <CheckCircle className="w-4 h-4" /> Saved
              </div>
            ) : (
              <Button icon={Save} onClick={handleSave} loading={saving} disabled={students.length === 0}>
                Save Attendance
              </Button>
            )}
          </div>
        </div>

        {loading ? <div className="p-8"><LoadingScreen /></div> :
          students.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No students in this class"
              message={`No active students found in ${classLevel}${stream}.`} />
          ) : (
            <div className="divide-y divide-slate-50">
              {students.map((student, idx) => {
                const status = records[student.id] || 'absent';
                return (
                  <div key={student.id} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50/60 transition-colors">
                    <span className="text-xs text-slate-400 w-7 text-right flex-shrink-0">{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800">{student.fullName}</p>
                      <p className="text-xs text-slate-400">{student.admissionNumber}</p>
                    </div>
                    {/* Status buttons */}
                    <div className="flex items-center gap-1.5">
                      {Object.entries(STATUS_CONFIG).map(([s, cfg]) => {
                        const Icon = cfg.icon;
                        const active = status === s;
                        return (
                          <button key={s} onClick={() => setStatus(student.id, s)}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium transition-all ${
                              active ? `${cfg.bg} ${cfg.color} border-current` : 'border-slate-200 text-slate-400 hover:border-slate-300'
                            }`}
                          >
                            <Icon className="w-3 h-3" />
                            <span className="hidden sm:inline">{cfg.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        }
      </Card>
    </div>
  );
};

export default Attendance;
