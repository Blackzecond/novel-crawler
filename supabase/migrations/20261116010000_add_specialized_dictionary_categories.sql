-- Add specialized categories for Chinese cultivation and fantasy terminology.
alter table public.global_dictionary_entries
  drop constraint if exists global_dictionary_entries_category_check;

alter table public.global_dictionary_entries
  add constraint global_dictionary_entries_category_check
  check (category in (
    'brand', 'food', 'drink', 'app', 'place', 'culture', 'unit', 'title',
    'sect', 'cultivation', 'technique', 'item', 'creature', 'other'
  ));
