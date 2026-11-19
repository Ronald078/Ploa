import React, { useEffect,useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { useDashboard } from './api.js';
import { Leads } from './Leads.jsx';
import { Copies } from './Copies.jsx';
import { Messages } from './Messages.jsx';
import { Search } from './Search.jsx';
import { Ai } from './Ai.jsx';
import { Funnel } from './Funnel.jsx';
import { useRoute } from './navigation.js';
import { Dashboard } from './Dashboard.jsx';
import { Shell } from './Shell.jsx';
import { dateLabel } from './model.js';
import {usePageMotion} from './motion.js';
import {useAccountContext} from './account-client.js';
import {AccountSetup} from './AccountSetup.jsx';
import {OperatorContext} from './operator-context.jsx';
import './next.css';
import './restore.css';
import './mobile-buttons.css';
import './action-feedback.css';

class ScreenBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="next-fatal"><h1>Não foi possível exibir esta página</h1><p>Recarregue o Ploa para tentar novamente.</p><button type="button" className="button" onClick={() => location.reload()}>Tentar novamente</button></main>;
    return this.props.children;
  }
}

function App() {
  const route = useRoute();
  useEffect(() => { document.documentElement.dataset.ploaReady = 'true'; }, []);
  const account=useAccountContext();
  const { data, busy, error, refresh:refreshData } = useDashboard(route.view,account.ready,account.data?.account?.workspaceId||'');
  const refresh=()=>Promise.all([refreshData(),account.refresh()]);
  const page=useRef(null);usePageMotion(page,route.view,Boolean(data));
  const syncLabel = error ? 'Atualização indisponível' : busy ? 'Atualizando…' : data ? data.dashboard?.resumo?.atualizado_em ? 'Atualizado às ' + dateLabel(data.dashboard.resumo.atualizado_em, true).split(' ').at(-1) : 'Dados atualizados' : 'Aguardando dados';
  return <OperatorContext.Provider value={account.data?.account?.name||(account.ready?'Ronald':'Atendimento')}><Shell view={route.view} busy={busy} syncLabel={syncLabel} refresh={refresh} account={account.data}>
    {account.error?<div className="next-error" role="alert">{account.error}<button className="button" onClick={account.refresh}>Tentar novamente</button></div>:null}
    {account.data?.setup?.required?<AccountSetup context={account.data} refresh={refresh}/>:null}
    {error ? <div className="next-error" role="alert"><strong>{error}</strong><p>{data ? 'Mostrando a última leitura disponível.' : 'Confira se o Ploa está aberto e tente atualizar novamente.'}</p></div> : null}
    <div ref={page} className="next-view-stage" aria-busy={busy&&!data}>{data ? route.view === 'ai' ? <Ai data={data} refresh={refresh} /> : route.view === 'search' ? <Search data={data} refresh={refresh} /> : route.view === 'messages' ? <Messages data={data} refresh={refresh} /> : route.view === 'copies' ? <Copies data={data} refresh={refresh} /> : route.view === 'funnel' ? <Funnel data={data} /> : route.view === 'leads' ? <Leads data={data} routeSearch={route.search} refresh={refresh} /> : <Dashboard data={data} businessName={account.data?.account?.businessName} /> : null}</div>
  </Shell></OperatorContext.Provider>;
}

createRoot(document.getElementById('root')).render(<ScreenBoundary><App /></ScreenBoundary>);
