-- Enforce basic privacy hygiene in the database too, so an altered client cannot
-- place obvious identifiers or sensitive/private fields into either knowledge table.

ALTER TABLE public.synqme_knowledge_candidates
  ADD CONSTRAINT synqme_knowledge_candidates_no_identifiers_or_sensitive_data
  CHECK (
    concat_ws(' ', prompt_pattern, answer_pattern, general_principle, applicability::text,
      array_to_string(context_tags, ' '), array_to_string(key_terms, ' '),
      array_to_string(limitations, ' '))
      !~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
    AND concat_ws(' ', prompt_pattern, answer_pattern, general_principle, applicability::text,
      array_to_string(context_tags, ' '), array_to_string(key_terms, ' '),
      array_to_string(limitations, ' '))
      !~* '(https?://|www\.)'
    AND concat_ws(' ', prompt_pattern, answer_pattern, general_principle, applicability::text,
      array_to_string(context_tags, ' '), array_to_string(key_terms, ' '),
      array_to_string(limitations, ' '))
      !~* '\m[0-9]{1,4}\s+([[:alnum:]-]+\s+){0,4}(street|st|road|rd|avenue|ave|lane|ln|drive|dr|court|ct|way|close|place|pl|boulevard|blvd)\M'
    AND concat_ws(' ', prompt_pattern, answer_pattern, general_principle, applicability::text,
      array_to_string(context_tags, ' '), array_to_string(key_terms, ' '),
      array_to_string(limitations, ' '))
      !~* '\m\+?[0-9][0-9(). -]{7,}[0-9]\M'
    AND concat_ws(' ', prompt_pattern, answer_pattern, general_principle, applicability::text,
      array_to_string(context_tags, ' '), array_to_string(key_terms, ' '),
      array_to_string(limitations, ' '))
      !~* '(my name is|i live at|my address|my phone number|my email|my postcode|my zip code|medical history|diagnosis|medication|prescription|religious beliefs|political affiliation|sexual orientation|ethnicity|racial identity|bank balance|salary|immigration status|passport number|national insurance|social security|door code|alarm code|access code|password|api key)'
    AND concat_ws(' ', prompt_pattern, answer_pattern, general_principle)
      !~* '(^|[^[:alnum:]])(i|me|my|mine|we|our|ours|myself)([^[:alnum:]]|$)'
  );

ALTER TABLE public.synqme_shared_knowledge
  ADD CONSTRAINT synqme_shared_knowledge_no_identifiers_or_sensitive_data
  CHECK (
    concat_ws(' ', prompt_pattern, answer_pattern, general_principle, applicability::text,
      array_to_string(context_tags, ' '), array_to_string(key_terms, ' '),
      array_to_string(limitations, ' '))
      !~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
    AND concat_ws(' ', prompt_pattern, answer_pattern, general_principle, applicability::text,
      array_to_string(context_tags, ' '), array_to_string(key_terms, ' '),
      array_to_string(limitations, ' '))
      !~* '(https?://|www\.)'
    AND concat_ws(' ', prompt_pattern, answer_pattern, general_principle, applicability::text,
      array_to_string(context_tags, ' '), array_to_string(key_terms, ' '),
      array_to_string(limitations, ' '))
      !~* '\m[0-9]{1,4}\s+([[:alnum:]-]+\s+){0,4}(street|st|road|rd|avenue|ave|lane|ln|drive|dr|court|ct|way|close|place|pl|boulevard|blvd)\M'
    AND concat_ws(' ', prompt_pattern, answer_pattern, general_principle, applicability::text,
      array_to_string(context_tags, ' '), array_to_string(key_terms, ' '),
      array_to_string(limitations, ' '))
      !~* '\m\+?[0-9][0-9(). -]{7,}[0-9]\M'
    AND concat_ws(' ', prompt_pattern, answer_pattern, general_principle, applicability::text,
      array_to_string(context_tags, ' '), array_to_string(key_terms, ' '),
      array_to_string(limitations, ' '))
      !~* '(my name is|i live at|my address|my phone number|my email|my postcode|my zip code|medical history|diagnosis|medication|prescription|religious beliefs|political affiliation|sexual orientation|ethnicity|racial identity|bank balance|salary|immigration status|passport number|national insurance|social security|door code|alarm code|access code|password|api key)'
    AND concat_ws(' ', prompt_pattern, answer_pattern, general_principle)
      !~* '(^|[^[:alnum:]])(i|me|my|mine|we|our|ours|myself)([^[:alnum:]]|$)'
  );
