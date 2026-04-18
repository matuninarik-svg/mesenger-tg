import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

export async function query(text: string, params?: any[]) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

export async function initDB() {
  // Check connection
  await query('SELECT NOW()');
  console.log('Database connected');
  
  // Run migrations
  await runMigrations();
}

async function runMigrations() {
  // Users table
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      first_name VARCHAR(100),
      last_name VARCHAR(100),
      avatar_url TEXT,
      bio VARCHAR(200),
      phone VARCHAR(20),
      is_verified BOOLEAN DEFAULT FALSE,
      verification_code VARCHAR(6),
      two_factor_enabled BOOLEAN DEFAULT FALSE,
      two_factor_secret VARCHAR(255),
      privacy_settings JSONB DEFAULT '{"phone": "contacts", "avatar": "all", "last_seen": "all", "can_write": "all", "can_add_to_groups": "all"}',
      last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Sessions table
  await query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      refresh_token VARCHAR(500) NOT NULL,
      device_info JSONB,
      ip_address VARCHAR(45),
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Chats table
  await query(`
    CREATE TABLE IF NOT EXISTS chats (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type VARCHAR(20) NOT NULL CHECK (type IN ('private', 'group', 'channel')),
      name VARCHAR(255),
      description TEXT,
      avatar_url TEXT,
      owner_id UUID REFERENCES users(id),
      is_public BOOLEAN DEFAULT FALSE,
      invite_link VARCHAR(255) UNIQUE,
      settings JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Chat participants
  await query(`
    CREATE TABLE IF NOT EXISTS chat_participants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(50) DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'muted', 'banned')),
      joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      last_read_message_id UUID,
      is_archived BOOLEAN DEFAULT FALSE,
      is_muted BOOLEAN DEFAULT FALSE,
      UNIQUE(chat_id, user_id)
    )
  `);

  // Messages table
  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
      sender_id UUID REFERENCES users(id),
      content TEXT,
      type VARCHAR(50) DEFAULT 'text' CHECK (type IN ('text', 'image', 'video', 'audio', 'file', 'voice', 'video_note', 'sticker', 'gif', 'location', 'contact', 'poll')),
      media_url TEXT,
      media_metadata JSONB,
      reply_to_id UUID REFERENCES messages(id),
      is_edited BOOLEAN DEFAULT FALSE,
      is_deleted BOOLEAN DEFAULT FALSE,
      is_pinned BOOLEAN DEFAULT FALSE,
      views_count INTEGER DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Message reactions
  await query(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      emoji VARCHAR(50) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(message_id, user_id, emoji)
    )
  `);

  // Message reads
  await query(`
    CREATE TABLE IF NOT EXISTS message_reads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      read_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(message_id, user_id)
    )
  `);

  // Files table
  await query(`
    CREATE TABLE IF NOT EXISTS files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      filename VARCHAR(255) NOT NULL,
      original_name VARCHAR(255),
      mime_type VARCHAR(100),
      size BIGINT NOT NULL,
      path TEXT NOT NULL,
      url TEXT,
      thumbnail_url TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Contacts table
  await query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      contact_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      display_name VARCHAR(255),
      phone VARCHAR(20),
      is_blocked BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, contact_user_id)
    )
  `);

  // Folders table
  await query(`
    CREATE TABLE IF NOT EXISTS folders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      icon VARCHAR(50),
      color VARCHAR(20),
      chat_ids UUID[] DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Saved messages (favorites)
  await query(`
    CREATE TABLE IF NOT EXISTS saved_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, message_id)
    )
  `);

  // Group admins
  await query(`
    CREATE TABLE IF NOT EXISTS group_admin_rights (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      can_change_info BOOLEAN DEFAULT FALSE,
      can_post_messages BOOLEAN DEFAULT TRUE,
      can_edit_messages BOOLEAN DEFAULT FALSE,
      can_delete_messages BOOLEAN DEFAULT FALSE,
      can_invite_users BOOLEAN DEFAULT FALSE,
      can_restrict_members BOOLEAN DEFAULT FALSE,
      can_pin_messages BOOLEAN DEFAULT FALSE,
      can_promote_members BOOLEAN DEFAULT FALSE,
      UNIQUE(chat_id, user_id)
    )
  `);

  // Channel subscribers
  await query(`
    CREATE TABLE IF NOT EXISTS channel_subscribers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      channel_id UUID REFERENCES chats(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      subscribed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(channel_id, user_id)
    )
  `);

  // Call records
  await query(`
    CREATE TABLE IF NOT EXISTS calls (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      caller_id UUID REFERENCES users(id),
      receiver_id UUID REFERENCES users(id),
      chat_id UUID REFERENCES chats(id),
      type VARCHAR(20) CHECK (type IN ('voice', 'video', 'group')),
      status VARCHAR(50) DEFAULT 'initiated' CHECK (status IN ('initiated', 'accepted', 'rejected', 'missed', 'ended')),
      started_at TIMESTAMP WITH TIME ZONE,
      ended_at TIMESTAMP WITH TIME ZONE,
      duration INTEGER,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Indexes for performance
  await query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_chats_type ON chats(type)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_chat_participants_chat_id ON chat_participants(chat_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_chat_participants_user_id ON chat_participants(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id)`);

  console.log('Database migrations completed');
}

export default pool;
