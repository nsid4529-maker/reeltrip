'use client';
import {WorkspaceHeader} from '@/components/workspace-navigation';
import {JoinInvite} from '@/components/shared-bucket';

// /join#<token>: the invite token stays in the fragment, out of server logs.
export default function JoinPage(){
 return <div className="reel-app"><WorkspaceHeader active="shared"/><main className="reservation-examples shared-page"><JoinInvite/></main></div>;
}
