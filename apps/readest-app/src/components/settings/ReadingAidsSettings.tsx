import React, { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { saveViewSettings } from '@/helpers/settings';
import { ReadingAidsConfig, SentenceClickMode, ViewSettings } from '@/types/book';
import { DEFAULT_READING_AIDS_CONFIG } from '@/services/constants';
import { BoxedList, SettingsRow, SettingsSelect, SettingsSwitchRow } from './primitives';
import ColorInput from './theme/ColorInput';

interface ReadingAidsSettingsProps {
  bookKey: string;
}

type ColorKey = 'waspLineColor1' | 'waspLineColor2' | 'waspLineDarkColor1' | 'waspLineDarkColor2';

/** Settings for the fork's reading aids: sentence highlighting, WaspLine and Obsidian sync. */
const ReadingAidsSettings: React.FC<ReadingAidsSettingsProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey);
  const initial: ReadingAidsConfig = { ...DEFAULT_READING_AIDS_CONFIG, ...(viewSettings ?? {}) };
  const [values, setValues] = useState<ReadingAidsConfig>(initial);

  const update = <K extends keyof ReadingAidsConfig>(key: K, value: ReadingAidsConfig[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    // Not a stylesheet change, so the book's styles are not re-applied.
    void saveViewSettings(envConfig, bookKey, key, value as ViewSettings[K], false, false);
  };

  const chooseObsidianFolder = async () => {
    const folder = await appService?.selectDirectory('write');
    if (folder) update('obsidianFolder', folder);
  };

  const colorRow = (key: ColorKey, label: string) => (
    <SettingsRow label={label}>
      <ColorInput
        label={label}
        value={values[key]}
        onChange={(color) => update(key, color)}
        showPickerIcon
        pickerPosition='right'
      />
    </SettingsRow>
  );

  return (
    <BoxedList title={_('Reading Aids')} data-setting-id='settings.control.readingAids'>
      <SettingsRow
        label={_('Click to Highlight Sentence')}
        data-setting-id='settings.control.sentenceClickMode'
      >
        <SettingsSelect
          value={values.sentenceClickMode}
          onChange={(e) => update('sentenceClickMode', e.target.value as SentenceClickMode)}
          ariaLabel={_('Click to Highlight Sentence')}
          options={[
            { value: 'click', label: _('Click') },
            { value: 'alt', label: _('Alt + Click') },
            { value: 'off', label: _('Off') },
          ]}
        />
      </SettingsRow>
      <SettingsSwitchRow
        label={_('WaspLine Line Colours')}
        description={_('Colour line ends to guide the eye to the next line')}
        checked={values.waspLineEnabled}
        onChange={() => update('waspLineEnabled', !values.waspLineEnabled)}
        data-setting-id='settings.control.waspLine'
      />
      {values.waspLineEnabled && (
        <>
          <SettingsRow label={_('Strength')}>
            <SettingsSelect
              value={String(values.waspLineIntensity)}
              onChange={(e) => update('waspLineIntensity', Number(e.target.value))}
              ariaLabel={_('Strength')}
              options={[
                { value: '0.4', label: _('Subtle') },
                { value: '0.7', label: _('Medium') },
                { value: '1', label: _('Full') },
              ]}
            />
          </SettingsRow>
          {colorRow('waspLineColor1', _('Light Pages, Colour 1'))}
          {colorRow('waspLineColor2', _('Light Pages, Colour 2'))}
          {colorRow('waspLineDarkColor1', _('Dark Pages, Colour 1'))}
          {colorRow('waspLineDarkColor2', _('Dark Pages, Colour 2'))}
        </>
      )}
      {appService?.isDesktopApp && (
        <SettingsSwitchRow
          label={_('Sync Highlights to Obsidian')}
          description={
            values.obsidianFolder
              ? _('One Markdown note per book in the chosen folder')
              : _('Choose your vault folder below')
          }
          checked={values.obsidianSyncEnabled}
          onChange={() => {
            const next = !values.obsidianSyncEnabled;
            update('obsidianSyncEnabled', next);
            if (next && !values.obsidianFolder) void chooseObsidianFolder();
          }}
          data-setting-id='settings.control.obsidianSync'
        />
      )}
      {appService?.isDesktopApp && values.obsidianSyncEnabled && (
        <SettingsRow label={_('Vault Folder')}>
          <button
            type='button'
            onClick={() => void chooseObsidianFolder()}
            title={values.obsidianFolder || undefined}
            className='btn btn-ghost btn-sm max-w-[14rem] truncate font-normal normal-case'
          >
            {values.obsidianFolder || _('Choose Folder')}
          </button>
        </SettingsRow>
      )}
    </BoxedList>
  );
};

export default ReadingAidsSettings;
