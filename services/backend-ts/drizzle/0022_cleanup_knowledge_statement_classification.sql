DELETE FROM retrieval_chunks rc
USING knowledge_claims kc
INNER JOIN knowledge_statements ks ON ks.id = kc.statement_id
WHERE rc.source_type = 'knowledge_claim'
  AND rc.source_id = kc.id
  AND lower(trim(kc.claim_text)) = lower(trim(ks.statement_text));

DELETE FROM knowledge_claims kc
USING knowledge_statements ks
WHERE kc.statement_id = ks.id
  AND lower(trim(kc.claim_text)) = lower(trim(ks.statement_text));

UPDATE knowledge_statements
SET scope = 'group',
    client_profile_id = NULL,
    updated_at = now(),
    metadata_json = metadata_json || jsonb_build_object('knowledge_kind', 'case', 'reclassified_at', now())
WHERE speaker_role = 'client'
  AND scope = 'personal'
  AND lower(statement_text) ~ '(beweis|screenshot|screen shot|hass|beleidigung|drohung|bedrohung|morddrohung|hetze|verleumdung|harassment|hate speech|insult|threat|strafbar|anzeige|polizei|gericht|anwalt|täter|opfer)';

UPDATE knowledge_claims kc
SET scope = ks.scope,
    client_profile_id = ks.client_profile_id,
    updated_at = now(),
    metadata_json = kc.metadata_json || jsonb_build_object('reclassified_at', now())
FROM knowledge_statements ks
WHERE kc.statement_id = ks.id;

UPDATE retrieval_chunks rc
SET scope = ks.scope,
    client_profile_id = ks.client_profile_id,
    updated_at = now(),
    metadata_json = rc.metadata_json || jsonb_build_object(
      'knowledge_kind',
      coalesce(ks.metadata_json->>'knowledge_kind', 'case'),
      'reclassified_at',
      now()
    )
FROM knowledge_statements ks
WHERE rc.source_type = 'knowledge_statement'
  AND rc.source_id = ks.id;

UPDATE retrieval_chunks rc
SET scope = kc.scope,
    client_profile_id = kc.client_profile_id,
    updated_at = now(),
    metadata_json = rc.metadata_json || jsonb_build_object('reclassified_at', now())
FROM knowledge_claims kc
WHERE rc.source_type = 'knowledge_claim'
  AND rc.source_id = kc.id;

DELETE FROM retrieval_chunks rc
USING knowledge_claims kc
INNER JOIN knowledge_statements ks ON ks.id = kc.statement_id
WHERE rc.source_type = 'knowledge_claim'
  AND rc.source_id = kc.id
  AND ks.speaker_role = 'client'
  AND lower(ks.statement_text) !~ '(ich heiße|mein name ist|ich bin [0-9]{1,3}( jahre alt)?|i am [0-9]{1,3}( years old)?|my name is|beweis|screenshot|screen shot|hass|beleidigung|drohung|bedrohung|morddrohung|hetze|verleumdung|harassment|hate speech|insult|threat|strafbar|anzeige|polizei|gericht|anwalt|täter|opfer)';

DELETE FROM retrieval_chunks rc
USING knowledge_statements ks
WHERE rc.source_type = 'knowledge_statement'
  AND rc.source_id = ks.id
  AND ks.speaker_role = 'client'
  AND lower(ks.statement_text) !~ '(ich heiße|mein name ist|ich bin [0-9]{1,3}( jahre alt)?|i am [0-9]{1,3}( years old)?|my name is|beweis|screenshot|screen shot|hass|beleidigung|drohung|bedrohung|morddrohung|hetze|verleumdung|harassment|hate speech|insult|threat|strafbar|anzeige|polizei|gericht|anwalt|täter|opfer)';

DELETE FROM knowledge_statements
WHERE speaker_role = 'client'
  AND lower(statement_text) !~ '(ich heiße|mein name ist|ich bin [0-9]{1,3}( jahre alt)?|i am [0-9]{1,3}( years old)?|my name is|beweis|screenshot|screen shot|hass|beleidigung|drohung|bedrohung|morddrohung|hetze|verleumdung|harassment|hate speech|insult|threat|strafbar|anzeige|polizei|gericht|anwalt|täter|opfer)';
