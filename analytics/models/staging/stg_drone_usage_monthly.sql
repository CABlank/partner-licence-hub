select
    drone_serial,
    month,
    flights,
    data_gb,
    cloud_jobs,
    external_jobs
from {{ source('telemetry', 'drone_usage_monthly') }}
