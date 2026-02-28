import React from 'react'

const BRAND = {
  navy: '#1a2b4a',
  coral: '#ff6b6b',
  white: '#ffffff',
  gray50: '#f9fafb',
}

export interface ProcessStep {
  label: string
  description: string
}

export interface ProcessStripProps {
  title: string
  steps: ProcessStep[]
}

export function ProcessStrip({ title, steps }: ProcessStripProps) {
  const displaySteps = steps.slice(0, 4)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: BRAND.navy,
        fontFamily: 'Inter',
        padding: '40px 48px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '32px',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: '28px',
            fontWeight: 700,
            color: BRAND.white,
            lineHeight: 1.2,
          }}
        >
          {title}
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: '14px',
            fontWeight: 700,
            color: BRAND.white,
            opacity: 0.5,
          }}
        >
          triplypro.com
        </div>
      </div>

      {/* Steps row */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          alignItems: 'center',
          gap: '0px',
        }}
      >
        {displaySteps.map((step, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              flex: 1,
            }}
          >
            {/* Step card */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                backgroundColor: BRAND.white,
                borderRadius: '16px',
                padding: '24px 16px',
                flex: 1,
                minHeight: '160px',
              }}
            >
              {/* Number circle */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '40px',
                  height: '40px',
                  backgroundColor: BRAND.coral,
                  color: BRAND.white,
                  borderRadius: '50%',
                  fontSize: '20px',
                  fontWeight: 700,
                  marginBottom: '12px',
                }}
              >
                {String(i + 1)}
              </div>

              {/* Label */}
              <div
                style={{
                  display: 'flex',
                  fontSize: '18px',
                  fontWeight: 700,
                  color: BRAND.navy,
                  marginBottom: '6px',
                  textAlign: 'center',
                }}
              >
                {step.label}
              </div>

              {/* Description */}
              <div
                style={{
                  display: 'flex',
                  fontSize: '13px',
                  color: BRAND.navy,
                  opacity: 0.7,
                  textAlign: 'center',
                  lineHeight: 1.4,
                }}
              >
                {step.description}
              </div>
            </div>

            {/* Arrow connector (not after last step) */}
            {i < displaySteps.length - 1 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '40px',
                  minWidth: '40px',
                  fontSize: '28px',
                  fontWeight: 700,
                  color: BRAND.coral,
                }}
              >
                {'>'}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
