import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { encryptCredential } from '@/lib/insurance/credential-vault'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { carrier_id, username, password, agent_number } = await req.json()

    if (!carrier_id || !username || !password) {
      return NextResponse.json(
        { error: 'carrier_id, username, password required' },
        { status: 400 }
      )
    }

    const { data: userRow } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!userRow) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const encrypted_username = encryptCredential(username)
    const encrypted_password = encryptCredential(password)

    const { data, error } = await supabase
      .from('ins_carrier_credentials')
      .upsert({
        tenant_id: userRow.tenant_id,
        carrier_id,
        encrypted_username,
        encrypted_password,
        agent_number: agent_number || null,
        is_active: true,
        login_failure_count: 0,
      }, { onConflict: 'tenant_id,carrier_id' })
      .select('id, carrier_id, agent_number, is_active')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userRow } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!userRow) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Return credentials WITHOUT decrypted values
    const { data, error } = await supabase
      .from('ins_carrier_credentials')
      .select('id, carrier_id, agent_number, is_active, last_login_success, login_failure_count, ins_carriers(name, slug, logo_url)')
      .eq('tenant_id', userRow.tenant_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
