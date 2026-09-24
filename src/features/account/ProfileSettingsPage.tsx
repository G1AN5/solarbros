import { useRef, useState, type FormEvent } from 'react'

import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { PageHeader } from '@/components/ui/PageHeader'
import { useAuth } from '@/app/auth/useAuth'
import { ROLE_LABEL } from '@/lib/labels'
import { useRemoveAvatar, useUpdateMyProfile, useUploadAvatar } from '@/lib/queries/profile'

/* ============================================================================
   ProfileSettingsPage — one page, all three portals.
   ----------------------------------------------------------------------------
   A customer, an accountant and a technician all want the same four things:
   their name spelled correctly, a phone number that reaches them, an address,
   and a photograph so the person on the other end of a ticket knows who they
   are talking to. Three copies of that would be three places to fix a bug.

   WHAT IS DELIBERATELY NOT EDITABLE
   Email address, role and account status are shown but locked. The database
   refuses to change them from a self-service write (migration 0061), so
   offering an input would mean offering a field that throws when saved. The
   explanation sits next to each one, because a greyed-out box with no reason
   reads as broken rather than as intended.
   ========================================================================== */

export function ProfileSettingsPage() {
  const { user, refreshProfile } = useAuth()
  const updateProfile = useUpdateMyProfile()
  const uploadAvatar = useUploadAvatar()
  const removeAvatar = useRemoveAvatar()

  const photoInput = useRef<HTMLInputElement>(null)
  const [saved, setSaved] = useState<string | null>(null)

  if (!user) return null

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return
    const form = new FormData(event.currentTarget)

    setSaved(null)
    updateProfile.mutate(
      {
        userId: user.id,
        fullName: String(form.get('fullName') ?? ''),
        phone: String(form.get('phone') ?? ''),
        address: String(form.get('address') ?? ''),
      },
      {
        onSuccess: async () => {
          // The header and sidebar read from auth state, not from this form.
          await refreshProfile()
          setSaved('Your details have been saved.')
        },
      },
    )
  }

  function handlePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || !user) return

    setSaved(null)
    uploadAvatar.mutate(
      { file, userId: user.id },
      {
        onSuccess: async () => {
          await refreshProfile()
          setSaved('Your photo has been updated.')
        },
      },
    )
    // Cleared so choosing the same file twice still fires a change event.
    event.target.value = ''
  }

  return (
    <div className="stack">
      <PageHeader
        title="Your profile"
        description="How your name and photo appear to everyone else in the system."
      />

      <FormError error={updateProfile.error ?? uploadAvatar.error ?? removeAvatar.error} />

      {saved && (
        <Card style={{ borderColor: 'var(--success-solid)' }}>
          <CardBody>
            <div className="row row--between">
              <span className="small strong">✓ {saved}</span>
              <Button variant="ghost" size="sm" onClick={() => setSaved(null)}>
                Dismiss
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ------------------------------------------------------- PHOTO */}
      <Card>
        <CardHeader title="Photo" />
        <CardBody>
          <div className="row" style={{ gap: 'var(--space-5)', alignItems: 'center' }}>
            <Avatar
              initials={user.avatarInitials}
              url={user.avatarUrl}
              name={user.fullName}
              size="lg"
            />

            <div className="stack stack--sm" style={{ flex: 1, minWidth: 0 }}>
              <input
                ref={photoInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handlePhoto}
                style={{ display: 'none' }}
              />
              <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={uploadAvatar.isPending}
                  onClick={() => photoInput.current?.click()}
                >
                  {uploadAvatar.isPending ? 'Uploading…' : user.avatarUrl ? 'Change' : 'Upload'}
                </Button>
                {user.avatarUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={removeAvatar.isPending}
                    onClick={() =>
                      removeAvatar.mutate(
                        { userId: user.id },
                        {
                          onSuccess: async () => {
                            await refreshProfile()
                            setSaved('Your photo has been removed.')
                          },
                        },
                      )
                    }
                  >
                    Remove
                  </Button>
                )}
              </div>
              <p className="xs dim">
                JPG, PNG or WebP, up to 2 MB. Square images look best. With no photo your initials
                are shown instead, which is what most accounts use.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ------------------------------------------------------ DETAILS */}
      <Card>
        <CardHeader title="Your details" />
        <CardBody>
          <form onSubmit={handleSave} className="stack">
            <div className="field">
              <label className="field__label" htmlFor="fullName">
                Full name
              </label>
              <input
                id="fullName"
                name="fullName"
                className="input"
                defaultValue={user.fullName}
                required
                maxLength={120}
              />
              <p className="xs dim" style={{ marginTop: 'var(--space-1)' }}>
                This is the name shown on your replies to customers and on anything you approve.
              </p>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="phone">
                Phone
              </label>
              <input
                id="phone"
                name="phone"
                className="input"
                type="tel"
                defaultValue={user.phone ?? ''}
                placeholder="+63 917 000 0000"
                maxLength={40}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="address">
                Address
              </label>
              <input
                id="address"
                name="address"
                className="input"
                defaultValue={user.address ?? ''}
                maxLength={200}
              />
            </div>

            <Button type="submit" variant="primary" disabled={updateProfile.isPending}>
              {updateProfile.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </form>
        </CardBody>
      </Card>

      {/* ------------------------------------------------- WHAT IS FIXED */}
      <Card>
        <CardHeader title="Account" />
        <CardBody>
          <div className="stack stack--sm">
            <div className="row row--between">
              <span className="small dim">Email address</span>
              <span className="small strong">{user.email}</span>
            </div>
            <div className="row row--between">
              <span className="small dim">Role</span>
              <span className="small strong">{ROLE_LABEL[user.role]}</span>
            </div>
          </div>

          <p className="xs dim" style={{ marginTop: 'var(--space-4)' }}>
            Neither can be changed here, and not by an administrator through the application either.
            A role is set once when your registration is approved; changing it means the company
            creating you a new account. Your email address is how the system identifies you, so it
            is changed in Supabase by whoever administers the database. Ask your administrator if
            either is wrong.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
