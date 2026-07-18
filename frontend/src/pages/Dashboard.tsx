import { useEffect, useState } from 'react';
import { 
  FolderOpen, 
  Bug, 
  GitBranch, 
  Wrench, 
  TrendingUp,
  Clock,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { projectApi, issueApi, updateApi, repairApi, healthApi } from '@/lib/api';
import { Project, Issue, UpdateRecord, RepairRecord } from '@/lib/api';

export function Dashboard() {
  const [stats, setStats] = useState({
    projects: 0,
    issues: 0,
    updates: 0,
    repairs: 0,
    criticalIssues: 0,
    pendingUpdates: 0,
    successRepairs: 0,
    avgResponseTime: 0,
  });

  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [recentIssues, setRecentIssues] = useState<Issue[]>([]);
  const [recentUpdates, setRecentUpdates] = useState<UpdateRecord[]>([]);
  const [recentRepairs, setRecentRepairs] = useState<RepairRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        const [projectsRes, issuesRes, updatesRes, repairsRes] = await Promise.all([
          projectApi.list(),
          issueApi.list(),
          updateApi.list({ limit: 10 }),
          repairApi.list({ limit: 10 }),
        ]);

        const projects = projectsRes.data || [];
        const issues = issuesRes.data || [];
        const updates = updatesRes.data || [];
        const repairs = repairsRes.data || [];

        setStats({
          projects: projects.length,
          issues: issues.length,
          updates: updates.length,
          repairs: repairs.length,
          criticalIssues: issues.filter(i => i.severity === 'critical').length,
          pendingUpdates: updates.filter(u => u.status === 'pending').length,
          successRepairs: repairs.filter(r => r.status === 'success').length,
          avgResponseTime: 45,
        });

        setRecentProjects(projects.slice(0, 5));
        setRecentIssues(issues.slice(0, 5));
        setRecentUpdates(updates.slice(0, 5));
        setRecentRepairs(repairs.slice(0, 5));
      } catch (error) {
        console.error('加载数据失败:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, []);

  const StatCard = ({ icon: Icon, label, value, color, subtext }: { 
    icon: any; 
    label: string; 
    value: number | string; 
    color: string;
    subtext?: string;
  }) => (
    <div className="bg-white rounded-xl p-5 border border-gray-100 hover:shadow-lg hover:border-gray-200 transition-all duration-300">
      <div className={`w-12 h-12 rounded-lg ${color} flex items-center justify-center mb-4`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <p className="text-3xl font-bold text-gray-800 mb-1">{value}</p>
      <p className="text-sm text-gray-500">{label}</p>
      {subtext && <p className="text-xs text-gray-400 mt-1">{subtext}</p>}
    </div>
  );

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-600';
      case 'high': return 'bg-orange-100 text-orange-600';
      case 'medium': return 'bg-yellow-100 text-yellow-600';
      case 'low': return 'bg-blue-100 text-blue-600';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-600';
      case 'applied':
      case 'success': return 'bg-green-100 text-green-600';
      case 'failed': return 'bg-red-100 text-red-600';
      case 'rolled_back': return 'bg-purple-100 text-purple-600';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-500 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">仪表盘</h1>
          <p className="text-gray-500 mt-1">欢迎回来，这是系统的概览信息</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Clock className="w-4 h-4" />
          <span>最后更新: 刚刚</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard 
          icon={FolderOpen} 
          label="项目总数" 
          value={stats.projects} 
          color="bg-blue-500"
        />
        <StatCard 
          icon={Bug} 
          label="代码缺陷" 
          value={stats.issues} 
          color="bg-orange-500"
          subtext={`${stats.criticalIssues} 个严重`}
        />
        <StatCard 
          icon={GitBranch} 
          label="自更新记录" 
          value={stats.updates} 
          color="bg-purple-500"
          subtext={`${stats.pendingUpdates} 个待处理`}
        />
        <StatCard 
          icon={Wrench} 
          label="自修复记录" 
          value={stats.repairs} 
          color="bg-green-500"
          subtext={`${stats.successRepairs} 个成功`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100">
          <div className="p-5 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">最近项目</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {recentProjects.length === 0 ? (
              <div className="p-8 text-center text-gray-400">暂无项目</div>
            ) : (
              recentProjects.map((project) => (
                <div key={project.id} className="p-5 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                        <FolderOpen className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-800">{project.name}</p>
                        <p className="text-sm text-gray-500">{project.path}</p>
                      </div>
                    </div>
                    <span className={`px-3 py-1 text-xs font-medium rounded-full ${
                      project.status === 'active' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {project.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100">
          <div className="p-5 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">最近代码缺陷</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {recentIssues.length === 0 ? (
              <div className="p-8 text-center text-gray-400">暂无缺陷</div>
            ) : (
              recentIssues.map((issue) => (
                <div key={issue.id} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between mb-2">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getSeverityColor(issue.severity)}`}>
                      {issue.severity}
                    </span>
                  </div>
                  <p className="text-sm text-gray-800 line-clamp-2">{issue.message}</p>
                  <p className="text-xs text-gray-400 mt-2">{issue.file}:{issue.line}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100">
          <div className="p-5 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">自更新记录</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {recentUpdates.length === 0 ? (
              <div className="p-8 text-center text-gray-400">暂无更新记录</div>
            ) : (
              recentUpdates.map((update) => (
                <div key={update.id} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(update.status)}`}>
                      {update.status}
                    </span>
                    <span className="text-xs text-gray-400">{update.target_version}</span>
                  </div>
                  <p className="text-sm text-gray-800">{update.update_type}</p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100">
          <div className="p-5 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">自修复记录</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {recentRepairs.length === 0 ? (
              <div className="p-8 text-center text-gray-400">暂无修复记录</div>
            ) : (
              recentRepairs.map((repair) => (
                <div key={repair.id} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(repair.status)}`}>
                      {repair.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-800">{repair.error_type}</p>
                  <p className="text-xs text-gray-400 mt-1">{repair.affected_component}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}